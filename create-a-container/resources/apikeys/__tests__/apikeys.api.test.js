/**
 * Integration tests for /api/v1/apikeys — written against the legacy router
 * BEFORE migration (manifesto §6 step 1) to pin the wire contract. They must
 * pass unchanged after the resource moves to resources/apikeys/.
 *
 * Auth uses Bearer API keys: apiAuth accepts them and csrfGuard exempts
 * Bearer-only requests, so no session/CSRF choreography is needed.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../tests/helpers/app');
const { sequelize, resetDb, closeDb, createUser, createApiKey } = require('../../../tests/helpers/db');

const SERIALIZED_KEYS = ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt'];

describe('/api/v1/apikeys', () => {
  let app;
  let alice; // owns authKey + an extra key
  let bob; // other user, owns bobKey
  let authKey; // { apiKey, plainKey } used as Alice's Bearer credential
  let bobAuthKey;

  beforeAll(async () => {
    app = buildApp();
    await resetDb();
    // First user created gets auto-promoted to sysadmins (User.afterCreate);
    // burn that on a throwaway so alice/bob are regular users.
    await createUser({ uid: 'firstadmin' });
    alice = await createUser({ uid: 'alice' });
    bob = await createUser({ uid: 'bob' });
    authKey = await createApiKey(alice, 'alice auth key');
    bobAuthKey = await createApiKey(bob, 'bob auth key');
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('auth', () => {
    test('401 without credentials', async () => {
      const res = await request(app).get('/api/v1/apikeys');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'unauthorized', message: 'Authentication required' },
      });
    });

    test('401 with an invalid Bearer key', async () => {
      const res = await request(app)
        .get('/api/v1/apikeys')
        .set('Authorization', 'Bearer not-a-real-key-aaaaaaaaaaaaaaaaaaaaaaaa');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });
  });

  describe('GET /', () => {
    test('lists only the caller\u2019s keys, newest first, serialized shape', async () => {
      const older = await createApiKey(alice, 'older key');
      // Sequelize guards createdAt against instance updates; backdate via SQL.
      await sequelize.query('UPDATE "ApiKeys" SET "createdAt" = :ts WHERE "id" = :id', {
        replacements: { ts: '2020-01-01 00:00:00.000 +00:00', id: older.apiKey.id },
      });

      const res = await request(app)
        .get('/api/v1/apikeys')
        .set(...bearer(authKey.plainKey));

      expect(res.status).toBe(200);
      const keys = res.body.data;
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.map((k) => k.id)).toContain(authKey.apiKey.id);
      expect(keys.map((k) => k.id)).not.toContain(bobAuthKey.apiKey.id);
      // newest first
      expect(keys[keys.length - 1].id).toBe(older.apiKey.id);
      // exact serialized shape — no keyHash, no uidNumber
      for (const k of keys) {
        expect(Object.keys(k).sort()).toEqual([...SERIALIZED_KEYS].sort());
      }
    });
  });

  describe('GET /:id', () => {
    test('200 for own key', async () => {
      const res = await request(app)
        .get(`/api/v1/apikeys/${authKey.apiKey.id}`)
        .set(...bearer(authKey.plainKey));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(authKey.apiKey.id);
      expect(res.body.data.keyPrefix).toBe(authKey.apiKey.keyPrefix);
      expect(res.body.data).not.toHaveProperty('keyHash');
    });

    test('404 for another user\u2019s key', async () => {
      const res = await request(app)
        .get(`/api/v1/apikeys/${bobAuthKey.apiKey.id}`)
        .set(...bearer(authKey.plainKey));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'not_found', message: 'API key not found' },
      });
    });

    test('404 for a nonexistent id', async () => {
      const res = await request(app)
        .get('/api/v1/apikeys/00000000-0000-4000-8000-000000000000')
        .set(...bearer(authKey.plainKey));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /', () => {
    test('201 returns the plaintext key exactly once, with warning', async () => {
      const res = await request(app)
        .post('/api/v1/apikeys')
        .set(...bearer(authKey.plainKey))
        .send({ description: 'ci deploy key' });

      expect(res.status).toBe(201);
      const { data } = res.body;
      expect(data.description).toBe('ci deploy key');
      expect(typeof data.key).toBe('string');
      expect(data.key).toHaveLength(43); // 32 bytes base64url
      expect(data.keyPrefix).toBe(data.key.substring(0, 8));
      expect(data.warning).toMatch(/only time/i);
      expect(data).not.toHaveProperty('keyHash');

      // The new key authenticates, and subsequent reads never expose it.
      const readBack = await request(app)
        .get(`/api/v1/apikeys/${data.id}`)
        .set(...bearer(data.key));
      expect(readBack.status).toBe(200);
      expect(readBack.body.data).not.toHaveProperty('key');
    });

    test('201 without a description (null)', async () => {
      const res = await request(app)
        .post('/api/v1/apikeys')
        .set(...bearer(authKey.plainKey))
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.data.description).toBeNull();
    });
  });

  describe('DELETE /:id', () => {
    test('204 for own key, and it is gone', async () => {
      const doomed = await createApiKey(alice, 'doomed');
      const res = await request(app)
        .delete(`/api/v1/apikeys/${doomed.apiKey.id}`)
        .set(...bearer(authKey.plainKey));
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      const gone = await request(app)
        .get(`/api/v1/apikeys/${doomed.apiKey.id}`)
        .set(...bearer(authKey.plainKey));
      expect(gone.status).toBe(404);
    });

    test('404 for another user\u2019s key (no cross-user deletion)', async () => {
      const res = await request(app)
        .delete(`/api/v1/apikeys/${bobAuthKey.apiKey.id}`)
        .set(...bearer(authKey.plainKey));
      expect(res.status).toBe(404);

      // Bob's key still works.
      const stillThere = await request(app)
        .get('/api/v1/apikeys')
        .set(...bearer(bobAuthKey.plainKey));
      expect(stillThere.status).toBe(200);
    });
  });
});
