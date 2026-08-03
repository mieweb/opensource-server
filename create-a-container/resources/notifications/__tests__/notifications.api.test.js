/**
 * Integration tests for /api/v1/notifications — the node-side event queue.
 *
 * Ingest (POST /) is admin-API-key only; the list/ack endpoints are owner
 * scoped. Auth uses Bearer API keys: apiAuth accepts them and csrfGuard exempts
 * Bearer-only requests, so no session/CSRF choreography is needed.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../tests/helpers/app');
const {
  sequelize,
  resetDb,
  closeDb,
  createUser,
  createApiKey,
} = require('../../../tests/helpers/db');
const { Site, Node, Container, Notification } = require('../../../models');

const SERIALIZED_KEYS = [
  'id',
  'source',
  'severity',
  'node',
  'ctid',
  'owner',
  'action',
  'message',
  'evidence',
  'eventAt',
  'acknowledgedAt',
  'acknowledgedBy',
  'createdAt',
  'updatedAt',
];

const VALID_PAYLOAD = {
  source: 'lxc-oomd',
  severity: 'critical',
  node: 'opensource-phxdc-pve1',
  ctid: 392,
  owner: 'alice',
  action: 'freeze',
  message: 'CT 392 frozen: memory PSI full avg10=83 for 45s',
  evidence: { psiFullAvg10: 83.6, topProcs: ['node', 'chrome'] },
  ts: 1771234560,
};

describe('/api/v1/notifications', () => {
  let app;
  let admin;
  let adminKey; // admin Bearer credential (may ingest)
  let alice;
  let aliceKey;
  let bob;
  let bobKey;

  beforeAll(async () => {
    // resetDb() before buildApp() — see apikeys suite for the ordering rationale.
    await resetDb();
    app = buildApp();
    await createUser({ uid: 'firstadmin' }); // burns the auto-admin promotion
    admin = await createUser({ uid: 'admin', admin: true });
    alice = await createUser({ uid: 'alice' });
    bob = await createUser({ uid: 'bob' });
    adminKey = await createApiKey(admin, 'admin key');
    aliceKey = await createApiKey(alice, 'alice key');
    bobKey = await createApiKey(bob, 'bob key');
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await Notification.destroy({ where: {}, truncate: true, restartIdentity: true });
  });

  describe('POST / (ingest)', () => {
    test('401 without credentials', async () => {
      const res = await request(app).post('/api/v1/notifications').send(VALID_PAYLOAD);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    test('403 with a non-admin key', async () => {
      const res = await request(app)
        .post('/api/v1/notifications')
        .set(...bearer(aliceKey.plainKey))
        .send(VALID_PAYLOAD);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    test('201 persists the payload and maps ts -> eventAt', async () => {
      const res = await request(app)
        .post('/api/v1/notifications')
        .set(...bearer(adminKey.plainKey))
        .send(VALID_PAYLOAD);
      expect(res.status).toBe(201);
      expect(Object.keys(res.body.data).sort()).toEqual([...SERIALIZED_KEYS].sort());
      expect(res.body.data).toMatchObject({
        source: 'lxc-oomd',
        severity: 'critical',
        node: 'opensource-phxdc-pve1',
        ctid: '392', // normalised to string
        owner: 'alice',
        action: 'freeze',
        evidence: { psiFullAvg10: 83.6 },
      });
      expect(new Date(res.body.data.eventAt).getTime()).toBe(1771234560 * 1000);

      const stored = await Notification.findByPk(res.body.data.id);
      expect(stored.acknowledgedAt).toBeNull();
    });

    test('400 on invalid severity', async () => {
      const res = await request(app)
        .post('/api/v1/notifications')
        .set(...bearer(adminKey.plainKey))
        .send({ ...VALID_PAYLOAD, severity: 'emergency' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(res.body.error.fields).toHaveProperty('severity');
    });

    test('400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/notifications')
        .set(...bearer(adminKey.plainKey))
        .send({ source: 'lxc-oomd' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    test('resolves owner from node + ctid when omitted', async () => {
      const site = await Site.create({ name: 'site-a', internalDomain: 'a.test' });
      const node = await Node.create({ name: 'pve-resolve', siteId: site.id });
      await Container.create({
        hostname: 'ct-resolve',
        username: 'bob',
        nodeId: node.id,
        siteId: site.id,
        containerId: '4001',
      });

      const res = await request(app)
        .post('/api/v1/notifications')
        .set(...bearer(adminKey.plainKey))
        .send({
          source: 'lxc-oomd',
          severity: 'warning',
          node: 'pve-resolve',
          ctid: 4001,
          message: 'detect only',
        });
      expect(res.status).toBe(201);
      expect(res.body.data.owner).toBe('bob');
    });

    test('stores a null owner when node + ctid do not resolve', async () => {
      const res = await request(app)
        .post('/api/v1/notifications')
        .set(...bearer(adminKey.plainKey))
        .send({
          source: 'lxc-oomd',
          severity: 'warning',
          node: 'no-such-node',
          ctid: 9999,
          message: 'orphan event',
        });
      expect(res.status).toBe(201);
      expect(res.body.data.owner).toBeNull();
    });
  });

  describe('GET / (owner-scoped list)', () => {
    beforeEach(async () => {
      await Notification.bulkCreate([
        { source: 's', severity: 'critical', owner: 'alice', message: 'a1' },
        { source: 's', severity: 'warning', owner: 'alice', message: 'a2', acknowledgedAt: new Date(), acknowledgedBy: 'alice' },
        { source: 's', severity: 'warning', owner: 'bob', message: 'b1' },
      ]);
    });

    test('401 without credentials', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
    });

    test('returns only the caller’s notifications', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set(...bearer(aliceKey.plainKey));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((n) => n.owner === 'alice')).toBe(true);
    });

    test('unacknowledged sort before acknowledged', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set(...bearer(aliceKey.plainKey));
      expect(res.body.data[0].message).toBe('a1'); // unacked
      expect(res.body.data[1].message).toBe('a2'); // acked
    });

    test('a user with no notifications gets an empty list', async () => {
      const other = await createUser({ uid: 'carol' });
      const carolKey = await createApiKey(other);
      const res = await request(app)
        .get('/api/v1/notifications')
        .set(...bearer(carolKey.plainKey));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    test('honours the limit query param', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?limit=1')
        .set(...bearer(aliceKey.plainKey));
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].message).toBe('a1');
    });
  });

  describe('POST /:id/ack', () => {
    let aliceNote;

    beforeEach(async () => {
      aliceNote = await Notification.create({
        source: 's',
        severity: 'critical',
        owner: 'alice',
        message: 'ack me',
      });
    });

    test('acknowledges a notification the caller owns', async () => {
      const res = await request(app)
        .post(`/api/v1/notifications/${aliceNote.id}/ack`)
        .set(...bearer(aliceKey.plainKey));
      expect(res.status).toBe(200);
      expect(res.body.data.acknowledgedAt).not.toBeNull();
      expect(res.body.data.acknowledgedBy).toBe('alice');
    });

    test('is idempotent', async () => {
      await request(app)
        .post(`/api/v1/notifications/${aliceNote.id}/ack`)
        .set(...bearer(aliceKey.plainKey));
      const first = await Notification.findByPk(aliceNote.id);
      const firstAt = first.acknowledgedAt.getTime();

      const res = await request(app)
        .post(`/api/v1/notifications/${aliceNote.id}/ack`)
        .set(...bearer(aliceKey.plainKey));
      expect(res.status).toBe(200);
      const second = await Notification.findByPk(aliceNote.id);
      expect(second.acknowledgedAt.getTime()).toBe(firstAt); // unchanged
    });

    test('404 when acking someone else’s notification', async () => {
      const res = await request(app)
        .post(`/api/v1/notifications/${aliceNote.id}/ack`)
        .set(...bearer(bobKey.plainKey));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    test('400 on a non-integer id', async () => {
      const res = await request(app)
        .post('/api/v1/notifications/not-a-number/ack')
        .set(...bearer(aliceKey.plainKey));
      expect(res.status).toBe(400);
    });
  });

  describe('POST /all/ack', () => {
    test('acknowledges only the caller’s unacked notifications', async () => {
      await Notification.bulkCreate([
        { source: 's', severity: 'critical', owner: 'alice', message: 'a1' },
        { source: 's', severity: 'warning', owner: 'alice', message: 'a2' },
        { source: 's', severity: 'warning', owner: 'bob', message: 'b1' },
      ]);

      const res = await request(app)
        .post('/api/v1/notifications/all/ack')
        .set(...bearer(aliceKey.plainKey));
      expect(res.status).toBe(200);
      expect(res.body.data.acknowledged).toBe(2);

      const bobUnacked = await Notification.count({
        where: { owner: 'bob', acknowledgedAt: null },
      });
      expect(bobUnacked).toBe(1); // bob's untouched
    });

    test('"all" is not treated as an id', async () => {
      // Regression guard for router ordering: /all/ack must match before /:id/ack.
      const res = await request(app)
        .post('/api/v1/notifications/all/ack')
        .set(...bearer(aliceKey.plainKey));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('acknowledged');
    });
  });
});
