/**
 * Agent check-in auth — the manager's own agent bootstraps over localhost with
 * no site row and no API key, so its POST /api/v1/agents carries neither a
 * Bearer token nor a CSRF token. Two guards must let it through: the app-level
 * csrfGuard (app.js) and the route-level checkinAuth (agents.js). This pins
 * that the credential-less localhost check-in is NOT rejected with 403, while
 * a non-localhost (proxied) credential-less check-in still is.
 *
 * supertest connects from 127.0.0.1, so requests are localhost by default;
 * an X-Forwarded-For header with a public client IP makes isLocalhostRequest
 * treat the request as proxied-remote (see middlewares/index.js).
 */

const request = require('supertest');
const { buildApp } = require('../../../../tests/helpers/app');
const { resetDb, closeDb } = require('../../../../tests/helpers/db');

describe('POST /api/v1/agents check-in auth', () => {
  let app;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('localhost bootstrap check-in (no Bearer, no CSRF token) is not blocked by CSRF', async () => {
    const res = await request(app)
      .post('/api/v1/agents')
      .send({ siteId: 1, hostname: 'manager.local' });

    // The site row doesn't exist yet (bootstrap), so the handler skips the
    // Agent write and returns the config snapshot. The key assertion is that
    // we reached the handler at all — not a 403 from either csrf guard.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  test('non-localhost check-in without credentials is rejected', async () => {
    const res = await request(app)
      .post('/api/v1/agents')
      // A public client IP in X-Forwarded-For marks the request as proxied,
      // so the localhost bypass does not apply.
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ siteId: 1, hostname: 'remote.example.com' });

    // Either the app-level CSRF guard (403 csrf_invalid) or the route-level
    // apiAuth (401 unauthorized) rejects it; the point is it does not succeed.
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });
});
