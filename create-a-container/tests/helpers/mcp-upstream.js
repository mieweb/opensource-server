/**
 * Stub MCP server that behaves like manager-control-program in HTTP mode: on
 * every POST it calls back GET /api/v1/session on the manager with the
 * caller's Authorization header (ForwardAuthorizationHeader) and returns
 * `{ apiStatus, api }`.
 */

const http = require('http');

/** @param {() => string} getApiBase manager base URL, resolved per request */
function startMcpUpstream(getApiBase) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const api = new URL('/api/v1/session', getApiBase());
      http.get(api, { headers: { authorization: req.headers.authorization || '' } }, (apiRes) => {
        let body = '';
        apiRes.on('data', (c) => (body += c));
        apiRes.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ apiStatus: apiRes.statusCode, api: JSON.parse(body) }));
        });
      });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

module.exports = { startMcpUpstream };
