/**
 * OAuth 2.1 authorization server (issue #512), end to end through the real
 * app: discovery -> register -> authorize (with and without a session, with
 * and without OIDC) -> token -> refresh (rotation, reuse detection) -> revoke.
 */

const request = require('supertest');
const { buildApp } = require('../../../tests/helpers/app');
const { listenApp, close } = require('../../../tests/helpers/listen');
const { resetDb, closeDb, createUser } = require('../../../tests/helpers/db');
const { REMOTE, PASSWORD, loggedInAgent, csrfFrom } = require('../../../tests/helpers/session');
const {
  REDIRECT_URI,
  pkcePair,
  registerClient,
  authorizeUrl,
  follow,
  startAuthorization,
  decide,
  authorize,
  exchangeCode,
  refreshTokens,
  obtainTokens,
} = require('../../../tests/helpers/oauth');
const { OAuthPayload } = require('../../../models');

const PUBLIC_ORIGIN = 'https://manager.example.test';
const PUBLIC = [['X-Forwarded-Proto', 'https'], ['X-Forwarded-Host', 'manager.example.test']];
const withPublic = (req) => PUBLIC.reduce((r, h) => r.set(...h), req);

describe('OAuth authorization server', () => {
  let server;
  let base;

  beforeAll(async () => {
    await resetDb();
    ({ server, base } = await listenApp(buildApp()));
    await createUser({ uid: 'firstadmin' });
    await createUser({ uid: 'alice' });
  });

  afterAll(async () => {
    await close(server);
    await closeDb();
  });

  describe('discovery', () => {
    test('authorization server metadata (RFC 8414) at the origin root, issuer = public origin', async () => {
      const res = await withPublic(request(base).get('/.well-known/oauth-authorization-server'));
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body).toMatchObject({
        issuer: PUBLIC_ORIGIN,
        authorization_endpoint: `${PUBLIC_ORIGIN}/oauth/authorize`,
        token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
        registration_endpoint: `${PUBLIC_ORIGIN}/oauth/register`,
        revocation_endpoint: `${PUBLIC_ORIGIN}/oauth/revoke`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
      });
      expect(res.body.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
      expect(res.body.grant_types_supported).not.toContain('implicit');
      expect(res.body.scopes_supported).toContain('manager');
    });

    test('OpenID discovery is served at the root too', async () => {
      const res = await withPublic(request(base).get('/.well-known/openid-configuration'));
      expect(res.status).toBe(200);
      expect(res.body.issuer).toBe(PUBLIC_ORIGIN);
    });

    test.each([
      ['/.well-known/oauth-protected-resource', PUBLIC_ORIGIN],
      ['/.well-known/oauth-protected-resource/mcp', `${PUBLIC_ORIGIN}/mcp`],
    ])('protected resource metadata (RFC 9728) at %s', async (path, resource) => {
      const res = await withPublic(request(base).get(path));
      expect(res.status).toBe(200);
      expect(res.body.resource).toBe(resource);
      expect(res.body.authorization_servers).toEqual([PUBLIC_ORIGIN]);
      expect(res.body.bearer_methods_supported).toEqual(['header']);
    });
  });

  describe('POST /oauth/register', () => {
    test('registers a VS Code-style public client (no application_type, custom scheme) without session or CSRF', async () => {
      const res = await request(base)
        .post('/oauth/register')
        .set(...REMOTE)
        .send({
          client_name: 'VS Code',
          redirect_uris: ['http://127.0.0.1/', 'vscode://vscode.github-authentication/did-authenticate', 'https://vscode.dev/redirect'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          unknown_field: 'ignored',
        });
      expect(res.status).toBe(201);
      expect(res.body.client_id).toMatch(/^mcp_/);
      expect(res.body.client_secret).toBeUndefined();
      expect(res.body.client_name).toBe('VS Code');
    });

    test('confidential clients (default auth method) get a secret once; stored hashed', async () => {
      const res = await request(base)
        .post('/oauth/register')
        .set(...REMOTE)
        .send({ redirect_uris: ['https://chat.example.com/cb'] });
      expect(res.status).toBe(201);
      expect(res.body.token_endpoint_auth_method).toBe('client_secret_basic');
      expect(res.body.client_secret).toEqual(expect.any(String));
      const row = await OAuthPayload.findOne({ where: { model: 'Client', id: res.body.client_id } });
      expect(row.payload.client_secret).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(JSON.stringify(row.payload)).not.toContain(res.body.client_secret);
    });

    test.each([
      ['http://evil.example.com/cb'],
      ['javascript:alert(1)'],
      ['https://ok.example.com/cb#frag'],
      ['relative/path'],
    ])('rejects redirect_uri %s', async (uri) => {
      const res = await request(base).post('/oauth/register').set(...REMOTE).send({ redirect_uris: [uri] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_redirect_uri');
    });

    test('rejects missing redirect_uris and unsupported grants/response types', async () => {
      const post = (body) => request(base).post('/oauth/register').set(...REMOTE).send(body);
      expect((await post({ client_name: 'x' })).body.error).toBe('invalid_client_metadata');
      expect((await post({ redirect_uris: [REDIRECT_URI], grant_types: ['implicit'] })).body.error).toBe('invalid_client_metadata');
      expect((await post({ redirect_uris: [REDIRECT_URI], grant_types: ['client_credentials'] })).body.error).toBe('invalid_client_metadata');
      expect((await post({ redirect_uris: [REDIRECT_URI], response_types: ['token'] })).body.error).toBe('invalid_client_metadata');
    });
  });

  describe('GET /oauth/authorize', () => {
    let client;
    beforeAll(async () => {
      client = await registerClient(base);
    });

    test('unknown client_id renders an error page and never redirects to the client', async () => {
      const { challenge } = pkcePair();
      const res = await request(base).get(authorizeUrl({ client_id: 'mcp_nope' }, { challenge })).set(...REMOTE);
      expect(res.status).toBe(400);
      expect(res.type).toBe('text/html');
      expect(res.headers.location).toBeUndefined();
    });

    test('unregistered redirect_uri renders an error page and never redirects', async () => {
      const { challenge } = pkcePair();
      const res = await request(base)
        .get(authorizeUrl(client, { challenge, redirectUri: 'https://attacker.example/cb' }))
        .set(...REMOTE);
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });

    test('missing PKCE redirects back with invalid_request, state and iss', async () => {
      const params = new URLSearchParams({
        response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT_URI, state: 'xyz', scope: 'manager',
      });
      const res = await withPublic(request(base).get(`/oauth/authorize?${params}`).set(...REMOTE));
      expect(res.status).toBe(303);
      const loc = new URL(res.headers.location);
      expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT_URI);
      expect(loc.searchParams.get('error')).toBe('invalid_request');
      expect(loc.searchParams.get('state')).toBe('xyz');
      expect(loc.searchParams.get('iss')).toBe(PUBLIC_ORIGIN);
    });

    test.each([
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ])('rejects %j with %s', async (extra, error) => {
      const { challenge } = pkcePair();
      const res = await request(base).get(authorizeUrl(client, { challenge, extra })).set(...REMOTE);
      expect(res.status).toBe(303);
      // Errors for response types other than `code` travel in the fragment.
      const loc = new URL(res.headers.location);
      const params = loc.hash ? new URLSearchParams(loc.hash.slice(1)) : loc.searchParams;
      expect(params.get('error')).toBe(error);
    });

    test('without a session, bounces to the SPA login and back to the interaction', async () => {
      const { challenge } = pkcePair();
      const loc = await startAuthorization(request.agent(base), base, client, { challenge });
      expect(loc).toBeInstanceOf(URL);
      expect(loc.pathname).toBe('/login');
      expect(loc.searchParams.get('redirect')).toMatch(/^\/oauth\/interaction\/[\w-]+$/);
    });

    test('with OIDC enabled, bounces straight to the IdP login', async () => {
      const keys = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'];
      const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
      Object.assign(process.env, { OIDC_ISSUER_URL: 'https://idp.example', OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 'secret' });
      try {
        const { challenge } = pkcePair();
        const loc = await startAuthorization(request.agent(base), base, client, { challenge });
        expect(loc.pathname).toBe('/api/v1/auth/oidc/login');
        expect(loc.searchParams.get('redirect')).toMatch(/^\/oauth\/interaction\//);
      } finally {
        for (const k of keys) {
          if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
      }
    });

    test('with a session, shows a consent page naming the client and redirect host; mints nothing', async () => {
      const agent = await loggedInAgent(base, 'alice');
      const { challenge } = pkcePair();
      const grantsBefore = await OAuthPayload.count({ where: { model: 'Grant' } });
      const page = await startAuthorization(agent, base, client, { challenge });
      expect(page.status).toBe(200);
      expect(page.text).toContain('Authorize Test MCP Client');
      expect(page.text).toContain('http://127.0.0.1:33418');
      expect(page.text).toContain('not verified');
      expect(csrfFrom(page.text)).toBeTruthy();
      const formAction = page.headers['content-security-policy'].split(';').map((d) => d.trim())
        .find((d) => d.startsWith('form-action'));
      expect(formAction).toBe("form-action 'self' http://127.0.0.1:33418");
      expect(await OAuthPayload.count({ where: { model: 'Grant' } })).toBe(grantsBefore);
    });

    test('a loopback redirect_uri may use any port', async () => {
      const agent = await loggedInAgent(base, 'alice');
      const { challenge } = pkcePair();
      const page = await startAuthorization(agent, base, client, { challenge, redirectUri: 'http://127.0.0.1:61000/callback' });
      expect(page.status).toBe(200);
    });
  });

  describe('consent POST', () => {
    let client;
    beforeAll(async () => {
      client = await registerClient(base);
    });

    async function consentPage(agent) {
      return startAuthorization(agent, base, client, { challenge: pkcePair().challenge });
    }

    test('requires the CSRF token', async () => {
      const agent = await loggedInAgent(base, 'alice');
      const page = await consentPage(agent);
      const action = page.text.match(/<form method="post" action="([^"]+)"/)[1];
      const res = await agent.post(action).set(...REMOTE).type('form').send({ decision: 'approve' });
      expect(res.status).toBe(403);
    });

    test('deny redirects with access_denied, state and iss', async () => {
      const agent = await loggedInAgent(base, 'alice');
      const loc = await decide(agent, base, await consentPage(agent), 'deny');
      expect(loc.searchParams.get('error')).toBe('access_denied');
      expect(loc.searchParams.get('state')).toBe('st-123');
      expect(loc.searchParams.get('iss')).toBe(base);
    });

    test('approve redirects with code, state and iss; a replayed POST is rejected', async () => {
      const agent = await loggedInAgent(base, 'alice');
      const page = await consentPage(agent);
      const action = page.text.match(/<form method="post" action="([^"]+)"/)[1];
      const body = { _csrf: csrfFrom(page.text), decision: 'approve' };
      const first = await agent.post(action).set(...REMOTE).type('form').send(body);
      expect(first.status).toBe(303);
      const replay = await agent.post(action).set(...REMOTE).type('form').send(body);
      expect(replay.status).toBe(400);

      const loc = await follow(agent, base, first);
      expect(loc.searchParams.get('code')).toBeTruthy();
      expect(loc.searchParams.get('state')).toBe('st-123');
      expect(loc.searchParams.get('iss')).toBe(base);
    });

    test('a repeated GET of an answered interaction continues instead of failing', async () => {
      const agent = request.agent(base);
      const first = await startAuthorization(agent, base, client, { challenge: pkcePair().challenge });
      const interaction = first.searchParams.get('redirect');
      const csrf = await agent.get('/api/v1/csrf-token').set(...REMOTE);
      await agent.post('/api/v1/auth/login').set(...REMOTE).set('X-CSRF-Token', csrf.body.data.csrfToken)
        .send({ username: 'alice', password: PASSWORD });
      // The SPA may navigate to the interaction twice after sign-in.
      const once = await agent.get(interaction).set(...REMOTE);
      const twice = await agent.get(interaction).set(...REMOTE);
      expect(once.status).toBe(303);
      expect(twice.status).toBe(303);
      const page = await follow(agent, base, twice);
      expect(page.status).toBe(200);
      expect(page.text).toContain('Authorize Test MCP Client');
    });

    test('no session: 401 page', async () => {
      const res = await request(base).post('/oauth/interaction/whatever').set(...REMOTE).set('Authorization', 'Bearer x')
        .type('form').send({ decision: 'approve' });
      expect(res.status).toBe(401);
    });
  });

  describe('sessions', () => {
    test('authorize -> login -> back -> approve -> token, starting without a session', async () => {
      const client = await registerClient(base);
      const { verifier, challenge } = pkcePair();
      const agent = request.agent(base);

      const bounce = await startAuthorization(agent, base, client, { challenge });
      const returnTo = bounce.searchParams.get('redirect');

      const csrf = await agent.get('/api/v1/csrf-token').set(...REMOTE);
      const login = await agent.post('/api/v1/auth/login').set(...REMOTE)
        .set('X-CSRF-Token', csrf.body.data.csrfToken)
        .send({ username: 'alice', password: PASSWORD, redirect: returnTo });
      expect(login.status).toBe(200);
      expect(login.body.data.redirect).toBe(returnTo);

      const page = await follow(agent, base, await agent.get(returnTo).set(...REMOTE));
      expect(page.status).toBe(200);
      const loc = await decide(agent, base, page);
      const tok = await exchangeCode(base, client, { code: loc.searchParams.get('code'), verifier });
      expect(tok.status).toBe(200);
      expect(tok.body.access_token).toEqual(expect.any(String));
    });

    test('a different manager user in the same browser gets their own consent and token', async () => {
      await createUser({ uid: 'bob' });
      const client = await registerClient(base);
      const agent = await loggedInAgent(base, 'alice');
      await obtainTokens(base, agent, client);

      // Switch the manager session to bob (same cookie jar, so the provider
      // still remembers alice).
      const csrf = await agent.get('/api/v1/csrf-token').set(...REMOTE);
      await agent.post('/api/v1/auth/logout').set(...REMOTE).set('X-CSRF-Token', csrf.body.data.csrfToken);
      const csrf2 = await agent.get('/api/v1/csrf-token').set(...REMOTE);
      await agent.post('/api/v1/auth/login').set(...REMOTE).set('X-CSRF-Token', csrf2.body.data.csrfToken)
        .send({ username: 'bob', password: PASSWORD });

      const { verifier, challenge } = pkcePair();
      const page = await startAuthorization(agent, base, client, { challenge });
      expect(page.text).toContain('Signed in as <strong>bob</strong>');
      const loc = await decide(agent, base, page);
      const tok = await exchangeCode(base, client, { code: loc.searchParams.get('code'), verifier });
      const grant = await OAuthPayload.findOne({ where: { model: 'AccessToken', accountId: 'bob' } });
      expect(tok.status).toBe(200);
      expect(grant).not.toBeNull();
    });
  });

  describe('POST /oauth/token', () => {
    let client;
    let agent;
    beforeAll(async () => {
      client = await registerClient(base);
      agent = await loggedInAgent(base, 'alice');
    });

    test('authorization_code -> access + refresh token, no-store, no CSRF needed; stored hashed', async () => {
      // RFC 8707: the same resource on both requests, as MCP clients do.
      const resource = `${base}/mcp`;
      const { code, verifier } = await authorize(agent, base, client, { extra: { resource } });
      const res = await exchangeCode(base, client, { code, verifier, extra: { resource } });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'manager' });
      expect(res.body.refresh_token).toEqual(expect.any(String));

      const rows = await OAuthPayload.findAll({ where: { model: ['AccessToken', 'RefreshToken'] } });
      for (const row of rows) {
        expect(row.id).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(row.payload)).not.toContain(res.body.access_token);
      }
    });

    test('a resource that was not authorized -> invalid_target', async () => {
      const { code, verifier } = await authorize(agent, base, client);
      const res = await exchangeCode(base, client, { code, verifier, extra: { resource: `${base}/other` } });
      expect(res.body.error).toBe('invalid_target');
    });

    test('a resource for another server -> invalid_target', async () => {
      const { code, verifier } = await authorize(agent, base, client);
      const res = await exchangeCode(base, client, { code, verifier, extra: { resource: 'https://other.example/mcp' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_target');
    });

    test('codes are single use', async () => {
      const { code, verifier } = await authorize(agent, base, client);
      expect((await exchangeCode(base, client, { code, verifier })).status).toBe(200);
      const again = await exchangeCode(base, client, { code, verifier });
      expect(again.status).toBe(400);
      expect(again.body.error).toBe('invalid_grant');
    });

    test.each([
      ['wrong verifier', (v) => ({ verifier: `${v}x`.slice(1) })],
      ['wrong redirect_uri', () => ({ redirectUri: 'http://127.0.0.1:33418/other' })],
    ])('%s -> invalid_grant', async (_label, mutate) => {
      const { code, verifier } = await authorize(agent, base, client);
      const res = await exchangeCode(base, client, { code, verifier, ...mutate(verifier) });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    test("a code can't be redeemed by another client", async () => {
      const other = await registerClient(base);
      const { code, verifier } = await authorize(agent, base, client);
      const res = await exchangeCode(base, other, { code, verifier });
      expect(res.body.error).toBe('invalid_grant');
    });

    test('unknown client -> 401 invalid_client; unknown grant type -> unsupported_grant_type', async () => {
      let res = await request(base).post('/oauth/token').set(...REMOTE).type('form')
        .send({ grant_type: 'authorization_code', client_id: 'mcp_nope', code: 'x' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
      res = await request(base).post('/oauth/token').set(...REMOTE).type('form')
        .send({ grant_type: 'password', client_id: client.client_id });
      expect(res.body.error).toBe('unsupported_grant_type');
    });

    test('refresh rotates; reusing a rotated refresh token revokes the whole grant', async () => {
      const first = await obtainTokens(base, agent, client);
      const second = await refreshTokens(base, client, first.refresh_token);
      expect(second.status).toBe(200);
      expect(second.body.refresh_token).not.toBe(first.refresh_token);
      expect(second.body.access_token).not.toBe(first.access_token);

      const reuse = await refreshTokens(base, client, first.refresh_token);
      expect(reuse.status).toBe(400);
      expect(reuse.body.error).toBe('invalid_grant');

      const after = await refreshTokens(base, client, second.body.refresh_token);
      expect(after.body.error).toBe('invalid_grant');
    });

    test('confidential clients must send their secret (Basic or form body)', async () => {
      const conf = await registerClient(base, { token_endpoint_auth_method: 'client_secret_basic' });

      const noSecret = await authorize(agent, base, conf);
      const res1 = await exchangeCode(base, conf, { code: noSecret.code, verifier: noSecret.verifier });
      expect(res1.status).toBe(401);
      expect(res1.body.error).toBe('invalid_client');

      const viaBasic = await authorize(agent, base, conf);
      const basic = Buffer.from(`${encodeURIComponent(conf.client_id)}:${encodeURIComponent(conf.client_secret)}`).toString('base64');
      const res2 = await request(base).post('/oauth/token').set(...REMOTE).set('Authorization', `Basic ${basic}`)
        .type('form').send({ grant_type: 'authorization_code', code: viaBasic.code, code_verifier: viaBasic.verifier, redirect_uri: REDIRECT_URI });
      expect(res2.status).toBe(200);

      const viaBody = await authorize(agent, base, conf);
      const res3 = await exchangeCode(base, conf, { code: viaBody.code, verifier: viaBody.verifier, extra: { client_secret: conf.client_secret } });
      expect(res3.status).toBe(200);

      const wrong = await authorize(agent, base, conf);
      const res4 = await exchangeCode(base, conf, { code: wrong.code, verifier: wrong.verifier, extra: { client_secret: 'nope' } });
      expect(res4.status).toBe(401);
    });
  });

  describe('POST /oauth/revoke', () => {
    let client;
    let agent;
    beforeAll(async () => {
      client = await registerClient(base);
      agent = await loggedInAgent(base, 'alice');
    });

    const revoke = (body) => request(base).post('/oauth/revoke').set(...REMOTE).type('form').send(body);

    test('revoking a refresh token revokes the grant', async () => {
      const tokens = await obtainTokens(base, agent, client);
      const res = await revoke({ token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: client.client_id });
      expect(res.status).toBe(200);
      expect((await refreshTokens(base, client, tokens.refresh_token)).body.error).toBe('invalid_grant');
      expect(await OAuthPayload.count({ where: { model: 'Grant', clientId: client.client_id } })).toBe(0);
    });

    test("revoking an access token revokes the grant's tokens but keeps the grant", async () => {
      const tokens = await obtainTokens(base, agent, client);
      const grantId = (await OAuthPayload.findOne({ where: { model: 'Grant', clientId: client.client_id } })).id;
      expect((await revoke({ token: tokens.access_token, client_id: client.client_id })).status).toBe(200);
      expect(await OAuthPayload.count({ where: { grantId } })).toBe(0);
      expect((await refreshTokens(base, client, tokens.refresh_token)).body.error).toBe('invalid_grant');
      expect(await OAuthPayload.count({ where: { model: 'Grant', id: grantId } })).toBe(1);
    });

    test('unknown tokens are ignored with 200', async () => {
      expect((await revoke({ token: 'garbage', client_id: client.client_id })).status).toBe(200);
    });
  });
});
