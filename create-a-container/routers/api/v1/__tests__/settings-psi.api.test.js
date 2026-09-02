/**
 * Integration tests for the usage_psi_probe_limit system setting (PR #452
 * review): the PSI probe budget is an admin Setting, not an env var.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');
const { Setting } = require('../../../../models');

describe('usage PSI probe limit setting', () => {
  let app;
  let adminKey;

  beforeAll(async () => {
    // Order matters: resetDb() first (see tests/helpers/app.js).
    await resetDb();
    app = buildApp();
    // First user created is auto-promoted to sysadmins (User.afterCreate).
    const admin = await createUser({ uid: 'psimin' });
    adminKey = (await createApiKey(admin, 'admin key')).plainKey;
  });

  afterAll(async () => {
    await closeDb();
  });

  async function putLimit(usagePsiProbeLimit) {
    return request(app)
      .put('/api/v1/settings')
      .set(...bearer(adminKey))
      .send({ usagePsiProbeLimit });
  }

  test('defaults to empty (server default applies)', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set(...bearer(adminKey));
    expect(res.status).toBe(200);
    expect(res.body.data.usagePsiProbeLimit).toBe('');
  });

  test('stores a non-negative integer, trimmed', async () => {
    expect((await putLimit(' 8 ')).status).toBe(200);
    expect(await Setting.get('usage_psi_probe_limit')).toBe('8');

    const res = await request(app)
      .get('/api/v1/settings')
      .set(...bearer(adminKey));
    expect(res.body.data.usagePsiProbeLimit).toBe('8');
  });

  test('accepts 0 (disables PSI collection)', async () => {
    expect((await putLimit('0')).status).toBe(200);
    expect(await Setting.get('usage_psi_probe_limit')).toBe('0');
  });

  test('normalizes garbage and negatives to empty (default)', async () => {
    for (const bad of ['abc', '-3', null]) {
      expect((await putLimit(bad)).status).toBe(200);
      expect(await Setting.get('usage_psi_probe_limit')).toBe('');
    }
  });
});
