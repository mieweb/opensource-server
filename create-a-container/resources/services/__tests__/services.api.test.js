/**
 * POST /api/v1/services/:id/last-access — proxy accounting endpoint.
 * Trust model mirrors the agent check-in (routers/api/v1/agents.js):
 * localhost posts without credentials (the manager's own proxy), remote
 * proxies authenticate with an admin API key. supertest connects from
 * 127.0.0.1; an X-Forwarded-For with a public IP marks a request as remote.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../tests/helpers/db');
const { Site, Node, Container, Service } = require('../../../models');

describe('POST /api/v1/services/:id/last-access', () => {
  let app;
  let service;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    const site = await Site.create({ name: 'test-site' });
    const node = await Node.create({ siteId: site.id, name: 'node1', nodeType: 'dummy' });
    const container = await Container.create({
      hostname: 'testct',
      username: 'tester',
      nodeId: node.id,
      siteId: site.id,
    });
    service = await Service.create({ containerId: container.id, type: 'http', internalPort: 80 });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('localhost without credentials records access', async () => {
    const before = Date.now();
    const res = await request(app).post(`/api/v1/services/${service.id}/last-access`);
    expect(res.status).toBe(204);

    await service.reload();
    expect(service.lastAccessedAt).not.toBeNull();
    const stamped = new Date(service.lastAccessedAt).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('remote without credentials is rejected', async () => {
    const res = await request(app)
      .post(`/api/v1/services/${service.id}/last-access`)
      .set('X-Forwarded-For', '203.0.113.7');
    expect([401, 403]).toContain(res.status);

    await service.reload();
    expect(service.lastAccessedAt).toBeNull();
  });

  test('remote with admin API key records access', async () => {
    const admin = await createUser({ admin: true });
    const { plainKey } = await createApiKey(admin);
    const res = await request(app)
      .post(`/api/v1/services/${service.id}/last-access`)
      .set('X-Forwarded-For', '203.0.113.7')
      .set(...bearer(plainKey));
    expect(res.status).toBe(204);

    await service.reload();
    expect(service.lastAccessedAt).not.toBeNull();
  });

  test('remote with non-admin API key is 403', async () => {
    // First user after resetDb is auto-promoted to sysadmins; burn one.
    await createUser();
    const plain = await createUser();
    const { plainKey } = await createApiKey(plain);
    const res = await request(app)
      .post(`/api/v1/services/${service.id}/last-access`)
      .set('X-Forwarded-For', '203.0.113.7')
      .set(...bearer(plainKey));
    expect(res.status).toBe(403);
  });

  test('unknown service id is 404', async () => {
    const res = await request(app).post('/api/v1/services/999999/last-access');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  test('non-numeric id is 400', async () => {
    const res = await request(app).post('/api/v1/services/abc/last-access');
    expect(res.status).toBe(400);
  });

  // The route is machine-facing (localhost or Bearer), but /api/v1 is behind
  // csrfGuard, which enforces CSRF only for session-cookie requests that carry
  // no Bearer. Pin that a remote session-authenticated request is rejected
  // without a CSRF token and succeeds with one, so the Bearer/localhost
  // exemptions can't silently regress into a CSRF hole.
  describe('session-authenticated (CSRF-guarded) access', () => {
    // A supertest agent persists cookies across requests, so the session
    // established by /csrf-token and /auth/login carries into the accounting
    // POST. X-Forwarded-For marks the request as remote so the localhost
    // bypass does not apply.
    async function loginAgent() {
      const admin = await createUser({ admin: true });
      const agent = request.agent(app);
      const tokenRes = await agent.get('/api/v1/csrf-token');
      const csrfToken = tokenRes.body.data.csrfToken;
      const loginRes = await agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: admin.uid, password: 'correct horse battery staple' });
      expect(loginRes.status).toBe(200);
      return { agent, csrfToken };
    }

    test('remote session request without a CSRF token is 403', async () => {
      const { agent } = await loginAgent();
      const res = await agent
        .post(`/api/v1/services/${service.id}/last-access`)
        .set('X-Forwarded-For', '203.0.113.7');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('csrf_invalid');

      await service.reload();
      expect(service.lastAccessedAt).toBeNull();
    });

    test('remote session request with a valid CSRF token records access', async () => {
      const { agent, csrfToken } = await loginAgent();
      const res = await agent
        .post(`/api/v1/services/${service.id}/last-access`)
        .set('X-Forwarded-For', '203.0.113.7')
        .set('X-CSRF-Token', csrfToken);
      expect(res.status).toBe(204);

      await service.reload();
      expect(service.lastAccessedAt).not.toBeNull();
    });
  });
});
