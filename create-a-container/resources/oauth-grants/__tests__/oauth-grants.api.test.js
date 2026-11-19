/**
 * /api/v1/oauth-grants ("Authorized apps", issue #514): users list and revoke
 * their own grants, admins see and revoke everyone's, and a revoked client's
 * next /mcp request gets 401.
 */

const http = require('http');
const request = require('supertest');
const { buildApp } = require('../../../app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../tests/helpers/db');
const { loggedInAgent } = require('../../../tests/helpers/session');
const { registerClient, obtainTokens } = require('../../../tests/helpers/oauth');

describe('/api/v1/oauth-grants', () => {
  let server;
  let base;
  let keys;
  let tokens;

  beforeAll(async () => {
    await resetDb();
    // /mcp points at a closed port: an authenticated request gets through
    // mcpAuth and fails upstream (502); an unauthenticated one stops at 401.
    const deadPort = await new Promise((resolve) => {
      const s = http.createServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });
    const app = buildApp({ sessionSecrets: ['test-secret'], accessLog: false, mcpServerUrl: `http://127.0.0.1:${deadPort}` });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;

    const admin = await createUser({ uid: 'firstadmin' }); // auto-promoted to sysadmins
    const alice = await createUser({ uid: 'alice' });
    const bob = await createUser({ uid: 'bob' });
    keys = {
      admin: (await createApiKey(admin)).plainKey,
      alice: (await createApiKey(alice)).plainKey,
      bob: (await createApiKey(bob)).plainKey,
    };

    tokens = {};
    for (const [uid, name] of [['alice', 'Alice Client'], ['bob', 'Bob Client']]) {
      const client = await registerClient(base, { client_name: name });
      tokens[uid] = await obtainTokens(base, await loggedInAgent(base, uid), client);
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeDb();
  });

  const as = (who) => (req) => req.set('Authorization', `Bearer ${keys[who]}`);
  const list = (who, query = '') => as(who)(request(base).get(`/api/v1/oauth-grants${query}`));
  const revoke = (who, id) => as(who)(request(base).delete(`/api/v1/oauth-grants/${id}`));

  test('a user lists only their own grants', async () => {
    const res = await list('alice');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      clientName: 'Alice Client',
      registrationType: 'dynamic',
      redirectHosts: ['http://127.0.0.1:33418'],
      scope: 'manager',
      user: 'alice',
    });
    expect(res.body.data[0].lastUsedAt).toBeNull();
    expect(res.body.data[0].createdAt).toEqual(expect.any(String));
  });

  test('lastUsedAt is recorded when the token is used', async () => {
    await request(base).get('/api/v1/session').set('Authorization', `Bearer ${tokens.alice.access_token}`);
    await new Promise((r) => setTimeout(r, 50));
    const res = await list('alice');
    expect(res.body.data[0].lastUsedAt).toEqual(expect.any(String));
  });

  test('?all=true is admin-only', async () => {
    expect((await list('alice', '?all=true')).status).toBe(403);
    const res = await list('admin', '?all=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map((g) => g.user).sort()).toEqual(['alice', 'bob']);
  });

  test("a user can't revoke someone else's grant (404)", async () => {
    const [bobGrant] = (await list('bob')).body.data;
    expect((await revoke('alice', bobGrant.id)).status).toBe(404);
    expect((await list('bob')).body.data).toHaveLength(1);
  });

  test('malformed id -> 400', async () => {
    expect((await revoke('alice', encodeURIComponent('not a valid id!'))).status).toBe(400);
  });

  test("revoking makes the client's next /mcp request return 401", async () => {
    const mcp = () => request(base).post('/mcp').set('Authorization', `Bearer ${tokens.alice.access_token}`).send({});
    expect((await mcp()).status).toBe(502); // authenticated, upstream down

    const [grant] = (await list('alice')).body.data;
    expect((await revoke('alice', grant.id)).status).toBe(204);
    expect((await list('alice')).body.data).toHaveLength(0);

    const res = await mcp();
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  test("admins can revoke anyone's grant", async () => {
    const [bobGrant] = (await list('bob')).body.data;
    expect((await revoke('admin', bobGrant.id)).status).toBe(204);
    const res = await request(base).get('/api/v1/session').set('Authorization', `Bearer ${tokens.bob.access_token}`);
    expect(res.status).toBe(401);
  });
});
