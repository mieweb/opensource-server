/**
 * Integration tests for /api/v1/sites/:siteId/usage — pin the wire contract
 * (manifesto §6 step 1). The test site has no nodes, so the collection cycle
 * completes without any Proxmox calls and returns the empty report shape.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../tests/helpers/db');
const { Site } = require('../../../models');

describe('/api/v1/sites/:siteId/usage', () => {
  let app;
  let site;
  let adminKey; // first user after resetDb() is auto-promoted to sysadmins
  let userKey;

  beforeAll(async () => {
    // Order matters: resetDb() first (see tests/helpers/app.js).
    await resetDb();
    app = buildApp();
    const admin = await createUser({ uid: 'admin' });
    const regular = await createUser({ uid: 'regular' });
    adminKey = await createApiKey(admin, 'admin key');
    userKey = await createApiKey(regular, 'regular key');
    site = await Site.create({ name: 'test-site', internalDomain: 'test.internal' });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('401 without credentials', async () => {
    const res = await request(app).get(`/api/v1/sites/${site.id}/usage`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'unauthorized', message: 'Authentication required' },
    });
  });

  test('403 for non-admins', async () => {
    const res = await request(app)
      .get(`/api/v1/sites/${site.id}/usage`)
      .set(...bearer(userKey.plainKey));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  test('404 for an unknown site', async () => {
    const res = await request(app)
      .get('/api/v1/sites/999999/usage')
      .set(...bearer(adminKey.plainKey));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'site_not_found', message: 'Site not found' },
    });
  });

  test('400 for a non-numeric siteId', async () => {
    const res = await request(app)
      .get('/api/v1/sites/not-a-number/usage')
      .set(...bearer(adminKey.plainKey));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  test('200 empty report envelope for a site with no nodes', async () => {
    const res = await request(app)
      .get(`/api/v1/sites/${site.id}/usage`)
      .set(...bearer(adminKey.plainKey));

    expect(res.status).toBe(200);
    const report = res.body.data;
    expect(Object.keys(report).sort()).toEqual(
      ['capacity', 'findings', 'generatedAt', 'owners', 'unknownNodeRows'],
    );
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
    expect(report.owners).toEqual([]);
    expect(report.capacity).toEqual({ cpuCores: 0, memBytes: 0, diskBytes: 0 });
    expect(report.findings).toEqual([]);
    expect(report.unknownNodeRows).toBe(0);
  });
});
