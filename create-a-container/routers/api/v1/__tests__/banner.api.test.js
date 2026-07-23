/**
 * Integration tests for the announcement banner: an admin-editable
 * `banner_message` Setting, written via PUT /api/v1/settings and exposed to
 * everyone (including unauthenticated visitors) via GET /api/v1/health.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');

describe('announcement banner', () => {
  let app;
  let adminKey; // Bearer credential for an admin user
  let userKey; // Bearer credential for a regular user

  beforeAll(async () => {
    // Order matters: resetDb() first (see tests/helpers/app.js).
    await resetDb();
    app = buildApp();
    // First user created is auto-promoted to sysadmins (User.afterCreate).
    const admin = await createUser({ uid: 'bannermin' });
    const user = await createUser({ uid: 'banneruser' });
    adminKey = (await createApiKey(admin, 'admin key')).plainKey;
    userKey = (await createApiKey(user, 'user key')).plainKey;
  });

  afterAll(async () => {
    await closeDb();
  });

  test('health reports no banner by default', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.banner).toBeNull();
  });

  test('non-admins cannot write settings', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .set(...bearer(userKey))
      .send({ bannerMessage: 'nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  test('admin sets the banner; health exposes it unauthenticated', async () => {
    const message = 'Try [Ozwell Studio](https://example.test/studio).';
    const put = await request(app)
      .put('/api/v1/settings')
      .set(...bearer(adminKey))
      .send({ bannerMessage: `  ${message}  ` }); // stored trimmed
    expect(put.status).toBe(200);

    const settings = await request(app)
      .get('/api/v1/settings')
      .set(...bearer(adminKey));
    expect(settings.status).toBe(200);
    expect(settings.body.data.bannerMessage).toBe(message);

    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.data.banner).toBe(message);
  });

  test('clearing the banner hides it again', async () => {
    const put = await request(app)
      .put('/api/v1/settings')
      .set(...bearer(adminKey))
      .send({ bannerMessage: '' });
    expect(put.status).toBe(200);

    const health = await request(app).get('/api/v1/health');
    expect(health.body.data.banner).toBeNull();
  });
});
