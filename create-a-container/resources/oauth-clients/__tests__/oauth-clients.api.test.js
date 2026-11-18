/**
 * client_credentials grant (issue #518): a user creates a confidential client
 * in the UI, a machine exchanges its id + secret for a token, and the token
 * calls /mcp (and through it /api/v1) as that user.
 */

const request = require('supertest');
const { buildApp } = require('../../../app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../tests/helpers/db');
const { startMcpUpstream } = require('../../../tests/helpers/mcp-upstream');
const { listenApp, close } = require('../../../tests/helpers/listen');
const { registerClient } = require('../../../tests/helpers/oauth');

describe('OAuth client credentials', () => {
  let upstream;
  let server;
  let base;
  let keys;

  beforeAll(async () => {
    await resetDb();
    upstream = await startMcpUpstream(() => base);
    ({ server, base } = await listenApp(buildApp({
      sessionSecrets: ['test-secret'],
      accessLog: false,
      mcpServerUrl: `http://127.0.0.1:${upstream.address().port}`,
    })));
    const admin = await createUser({ uid: 'firstadmin' });
    const alice = await createUser({ uid: 'alice' });
    const bob = await createUser({ uid: 'bob' });
    keys = {
      admin: (await createApiKey(admin)).plainKey,
      alice: (await createApiKey(alice)).plainKey,
      bob: (await createApiKey(bob)).plainKey,
    };
  });

  afterAll(async () => {
    await close(server);
    await close(upstream);
    await closeDb();
  });

  const as = (who) => (req) => req.set('Authorization', `Bearer ${keys[who]}`);
  const createClient = (who, name = 'CI bot') => as(who)(request(base).post('/api/v1/oauth-clients').send({ name }));
  const tokenFor = (body, basic) => {
    const req = request(base).post('/oauth/token').type('form');
    if (basic) req.set('Authorization', `Basic ${Buffer.from(`${basic.id}:${basic.secret}`).toString('base64')}`);
    return req.send({ grant_type: 'client_credentials', ...body });
  };
  const mcp = (token) => request(base).post('/mcp').set('Authorization', `Bearer ${token}`).send({});

  test('metadata advertises the grant', async () => {
    const res = await request(base).get('/.well-known/oauth-authorization-server');
    expect(res.body.grant_types_supported).toContain('client_credentials');
    expect(res.body.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
  });

  test('create -> secret shown once -> token (secret in body) -> /mcp acts as the owner', async () => {
    const created = await createClient('alice');
    expect(created.status).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    const { clientId, clientSecret, owner, name } = created.body.data;
    expect({ owner, name }).toEqual({ owner: 'alice', name: 'CI bot' });
    expect(clientSecret).toEqual(expect.any(String));

    const listed = await as('alice')(request(base).get('/api/v1/oauth-clients'));
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].clientSecret).toBeUndefined();

    const tok = await tokenFor({ client_id: clientId, client_secret: clientSecret, resource: `${base}/mcp` });
    expect(tok.status).toBe(200);
    expect(tok.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'manager' });
    expect(tok.body.refresh_token).toBeUndefined();

    const res = await mcp(tok.body.access_token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiStatus: 200, api: { data: { user: 'alice', isAdmin: false } } });
  });

  test('HTTP Basic client authentication works too', async () => {
    const { clientId, clientSecret } = (await createClient('alice', 'basic bot')).body.data;
    const tok = await tokenFor({}, { id: clientId, secret: clientSecret });
    expect(tok.status).toBe(200);
  });

  test('wrong secret -> 401 invalid_client', async () => {
    const { clientId } = (await createClient('alice')).body.data;
    const tok = await tokenFor({ client_id: clientId, client_secret: 'nope' });
    expect(tok.status).toBe(401);
    expect(tok.body.error).toBe('invalid_client');
  });

  test('resource for another server -> invalid_target', async () => {
    const { clientId, clientSecret } = (await createClient('alice')).body.data;
    const tok = await tokenFor({ client_id: clientId, client_secret: clientSecret, resource: 'https://other.example/mcp' });
    expect(tok.body.error).toBe('invalid_target');
  });

  test('dynamically registered clients may not use client_credentials', async () => {
    const dcr = await registerClient(base, { token_endpoint_auth_method: 'client_secret_post' });
    const tok = await tokenFor({ client_id: dcr.client_id, client_secret: dcr.client_secret });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe('unauthorized_client');

    const reg = await request(base).post('/oauth/register')
      .send({ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] });
    expect(reg.body.error).toBe('invalid_client_metadata');
  });

  test('owned clients cannot use the authorization code flow', async () => {
    const { clientId, clientSecret } = (await createClient('alice')).body.data;
    const tok = await tokenFor({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code: 'x' });
    expect(tok.body.error).toBe('unauthorized_client');
  });

  test('deleting the client kills its tokens; only the owner or an admin may delete', async () => {
    const { id, clientId, clientSecret } = (await createClient('alice', 'doomed')).body.data;
    const { access_token: token } = (await tokenFor({ client_id: clientId, client_secret: clientSecret })).body;
    expect((await mcp(token)).status).toBe(200);

    expect((await as('bob')(request(base).delete(`/api/v1/oauth-clients/${id}`))).status).toBe(404);
    expect((await as('alice')(request(base).delete(`/api/v1/oauth-clients/${id}`))).status).toBe(204);
    expect((await mcp(token)).status).toBe(401);
    expect((await tokenFor({ client_id: clientId, client_secret: clientSecret })).status).toBe(401);
  });

  test('admins list all clients with ?all=true; users may not', async () => {
    await createClient('bob', 'bob bot');
    expect((await as('alice')(request(base).get('/api/v1/oauth-clients?all=true'))).status).toBe(403);
    const all = await as('admin')(request(base).get('/api/v1/oauth-clients?all=true'));
    expect(new Set(all.body.data.map((c) => c.owner))).toEqual(new Set(['alice', 'bob']));
    const mine = await as('bob')(request(base).get('/api/v1/oauth-clients'));
    expect(mine.body.data.map((c) => c.owner)).toEqual(['bob']);
  });

  test('name is required', async () => {
    const res = await as('alice')(request(base).post('/api/v1/oauth-clients').send({}));
    expect(res.status).toBe(400);
  });
});
