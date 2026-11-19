/**
 * MCP OAuth end to end (issues #512 + #513), through the real app and a stub
 * MCP server that behaves like manager-control-program: it forwards the
 * caller's Authorization header to this app's /api/v1 (ForwardAuthorizationHeader).
 *
 *   /mcp without a token -> 401 + discovery challenge
 *   register -> authorize (login first) -> token -> /mcp -> /api/v1 as the user
 *   refresh -> /mcp with the new token -> revoke -> /mcp 401
 *
 * The app listens on one fixed port so the token audience (request origin)
 * is stable across requests.
 */

const http = require('http');
const request = require('supertest');
const { buildApp } = require('../../../app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../tests/helpers/db');
const { REMOTE, PASSWORD } = require('../../../tests/helpers/session');
const {
  pkcePair, registerClient, startAuthorization, follow, decide, exchangeCode, refreshTokens,
} = require('../../../tests/helpers/oauth');
const { listenApp, close } = require('../../../tests/helpers/listen');
const { OAuthPayload, Group } = require('../../../models');

/** Stub MCP server: on POST, calls back GET /api/v1/session with the caller's Authorization. */
function startUpstream(getApiBase) {
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

describe('MCP OAuth end to end', () => {
  let upstream;
  let server;
  let base;
  let alice;
  let origin;

  beforeAll(async () => {
    await resetDb();
    upstream = await startUpstream(() => base);
    const app = buildApp({
      sessionSecrets: ['test-secret'],
      accessLog: false,
      mcpServerUrl: `http://127.0.0.1:${upstream.address().port}`,
    });
    ({ server, base } = await listenApp(app));
    origin = base;
    await createUser({ uid: 'firstadmin' });
    alice = await createUser({ uid: 'alice' });
  });

  afterAll(async () => {
    await close(server);
    await close(upstream);
    await closeDb();
  });

  const mcp = (token) => {
    const req = request(base).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  /** register + authorize starting WITHOUT a session (login in between) + token. */
  async function signIn() {
    const client = await registerClient(base);
    const { verifier, challenge } = pkcePair();
    const agent = request.agent(base);
    const resource = `${origin}/mcp`;

    const bounce = await startAuthorization(agent, base, client, { challenge, extra: { resource } });
    expect(bounce.pathname).toBe('/login');
    const returnTo = bounce.searchParams.get('redirect');

    const csrf = await agent.get('/api/v1/csrf-token').set(...REMOTE);
    const login = await agent.post('/api/v1/auth/login').set(...REMOTE)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ username: 'alice', password: PASSWORD, redirect: returnTo });
    const page = await follow(agent, base, await agent.get(login.body.data.redirect).set(...REMOTE));
    const loc = await decide(agent, base, page);
    const tok = await exchangeCode(base, client, { code: loc.searchParams.get('code'), verifier, extra: { resource } });
    expect(tok.status).toBe(200);
    return { client, tokens: tok.body };
  }

  describe('401 challenge', () => {
    test('unauthenticated initialize -> 401 with resource_metadata derived from the public origin', async () => {
      const res = await mcp()
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'manager.example.test');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe(
        'Bearer resource_metadata="https://manager.example.test/.well-known/oauth-protected-resource/mcp", scope="manager"',
      );
      expect(res.headers['access-control-expose-headers']).toBe('WWW-Authenticate');
    });

    test('the advertised metadata URL resolves and points at this authorization server', async () => {
      const res = await mcp();
      const url = res.headers['www-authenticate'].match(/resource_metadata="([^"]+)"/)[1];
      const prm = await request(base).get(new URL(url).pathname);
      expect(prm.body.resource).toBe(`${origin}/mcp`);
      const as = await request(base).get('/.well-known/oauth-authorization-server');
      expect(prm.body.authorization_servers).toEqual([as.body.issuer]);
    });

    test.each([['notarealtoken0000000000000000000000000000000'], ['some-garbage-api-key']])(
      'invalid token %s -> 401 invalid_token', async (token) => {
        const res = await mcp(token);
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
      },
    );

    test('CORS preflight is not challenged', async () => {
      const res = await request(base).options('/mcp');
      expect(res.status).not.toBe(401);
    });
  });

  test('full flow: sign in -> /mcp -> /api/v1 as the user -> refresh -> revoke -> 401', async () => {
    const { client, tokens } = await signIn();

    let res = await mcp(tokens.access_token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiStatus: 200, api: { data: { user: 'alice', isAdmin: false } } });

    const refreshed = await refreshTokens(base, client, tokens.refresh_token);
    expect(refreshed.status).toBe(200);
    res = await mcp(refreshed.body.access_token);
    expect(res.body.api.data.user).toBe('alice');

    const revoked = await request(base).post('/oauth/revoke').type('form')
      .send({ token: refreshed.body.refresh_token, client_id: client.client_id });
    expect(revoked.status).toBe(200);
    res = await mcp(refreshed.body.access_token);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  test('expired access token -> 401 invalid_token so the client refreshes', async () => {
    const { tokens } = await signIn();
    for (const row of await OAuthPayload.findAll({ where: { model: 'AccessToken' } })) {
      await row.update({ payload: { ...row.payload, exp: Math.floor(Date.now() / 1000) - 1 } });
    }
    const res = await mcp(tokens.access_token);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('error_description="The access token expired"');
  });

  test('a token is rejected at /mcp on another origin (audience)', async () => {
    const { tokens } = await signIn();
    const res = await mcp(tokens.access_token).set('X-Forwarded-Host', 'other.example.test');
    expect(res.status).toBe(401);
  });

  test('/api/v1 accepts OAuth tokens directly; admin status follows current group membership', async () => {
    const { tokens } = await signIn();
    const session = () => request(base).get('/api/v1/session').set('Authorization', `Bearer ${tokens.access_token}`);
    expect((await session()).body.data).toEqual({ user: 'alice', isAdmin: false });

    await alice.addGroup(await Group.findByPk(2000));
    expect((await session()).body.data.isAdmin).toBe(true);
    await alice.removeGroup(await Group.findByPk(2000));
    expect((await session()).body.data.isAdmin).toBe(false);
  });

  test('API keys keep working on /mcp and /api/v1', async () => {
    const { plainKey } = await createApiKey(alice);
    const res = await mcp(plainKey);
    expect(res.body).toEqual({ apiStatus: 200, api: { data: { user: 'alice', isAdmin: false } } });
    const direct = await request(base).get('/api/v1/session').set('Authorization', `Bearer ${plainKey}`);
    expect(direct.status).toBe(200);
  });

  test('/api/v1 401s carry a Bearer challenge too', async () => {
    const res = await request(base).get('/api/v1/session');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(res.headers['www-authenticate']).toMatch(/^Bearer resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);
  });
});
