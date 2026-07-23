/**
 * Tests for the /mcp reverse proxy: requests stream through to the configured
 * MCP server with headers (notably Authorization) and bodies intact, responses
 * come back verbatim (including SSE content types), and the proxy degrades to
 * a 502 JSON error when the MCP server is down. When no MCP server is
 * configured the route is not mounted at all.
 */

const http = require('http');
const request = require('supertest');
const { buildApp } = require('../../app');
const { resetDb, closeDb } = require('../../tests/helpers/db');

/** Stub MCP upstream: echoes requests, and speaks SSE on GET. */
function startUpstream() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message\ndata: {"hello":"one"}\n\n');
      res.write('event: message\ndata: {"hello":"two"}\n\n');
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(201, {
        'content-type': 'application/json',
        'mcp-session-id': 'stub-session-1',
      });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization || null,
          contentType: req.headers['content-type'] || null,
          body,
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function build(mcpServerUrl) {
  return buildApp({
    sessionSecrets: ['test-secret'],
    rateLimit: false,
    accessLog: false,
    mcpServerUrl,
  });
}

describe('/mcp reverse proxy', () => {
  let upstream;
  let app;
  let deadApp;
  let bareApp;

  beforeAll(async () => {
    await resetDb();
    upstream = await startUpstream();
    const { port } = upstream.address();
    // Build every app variant here, right after resetDb: each buildApp
    // constructs a session store that fires an un-awaited CREATE TABLE, and
    // constructing one mid-test races that query against closeDb() (see
    // tests/helpers/app.js).
    app = build(`http://127.0.0.1:${port}`);
    const deadPort = await new Promise((resolve) => {
      const s = http.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    deadApp = build(`http://127.0.0.1:${deadPort}`);
    bareApp = build(undefined);
  });

  afterAll(async () => {
    await new Promise((resolve) => upstream.close(resolve));
    await closeDb();
  });

  test('forwards POST body, path, and Authorization header; returns upstream response', async () => {
    const payload = { jsonrpc: '2.0', method: 'initialize', id: 1 };
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer caller-token')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.headers['mcp-session-id']).toBe('stub-session-1');
    expect(res.body).toEqual({
      method: 'POST',
      url: '/mcp',
      authorization: 'Bearer caller-token',
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  test('preserves the query string', async () => {
    const res = await request(app).post('/mcp?foo=bar').send({});
    expect(res.status).toBe(201);
    expect(res.body.url).toBe('/mcp?foo=bar');
  });

  test('passes SSE responses through with their content type', async () => {
    const res = await request(app).get('/mcp').buffer(true).parse(
      // supertest has no default parser for text/event-stream; collect raw.
      (msg, cb) => {
        let data = '';
        msg.on('data', (chunk) => (data += chunk));
        msg.on('end', () => cb(null, data));
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.body).toContain('data: {"hello":"one"}');
    expect(res.body).toContain('data: {"hello":"two"}');
  });

  test('502 with a JSON error when the MCP server is unreachable', async () => {
    const res = await request(deadApp).post('/mcp').send({});
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('mcp_unavailable');
  });

  test('not mounted when no MCP server is configured', async () => {
    // Unproxied POST /mcp falls through to the app-level CSRF guard.
    const res = await request(bareApp).post('/mcp').send({});
    expect(res.status).toBe(403);
    expect(res.headers['mcp-session-id']).toBeUndefined();
  });
});
