/**
 * PUT /api/v1/sites/:siteId/containers/:id — volume attach/detach (issue #421).
 * Verifies that a volume mutation on a PROVISIONED container enqueues a
 * reconfigure job even without `restart: true` (the migration reconciler is
 * one-time, so normal attach/detach must schedule its own reconcile), and that
 * validation (reserved mount, duplicates) is enforced.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');
const { Site, Node, Container, Volume, Job } = require('../../../../models');

describe('PUT container volumes', () => {
  let app;
  let admin;
  let adminKey;
  let site;
  let provisioned;
  let unprovisioned;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    admin = await createUser({ admin: true });
    ({ plainKey: adminKey } = await createApiKey(admin));
    site = await Site.create({ name: 's', internalDomain: 'ex.test' });
    const node = await Node.create({ siteId: site.id, name: 'n', nodeType: 'dummy' });
    provisioned = await Container.create({
      hostname: 'prov',
      username: admin.uid,
      nodeId: node.id,
      siteId: site.id,
      containerId: '123', // has a provider id → provisioned
    });
    unprovisioned = await Container.create({
      hostname: 'unprov',
      username: admin.uid,
      nodeId: node.id,
      siteId: site.id,
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  function put(containerId, body) {
    return request(app)
      .put(`/api/v1/sites/${site.id}/containers/${containerId}`)
      .set(...bearer(adminKey))
      .send(body);
  }

  test('attaching a volume on a provisioned container enqueues a reconfigure job (no restart flag)', async () => {
    const res = await put(provisioned.id, {
      volumes: [{ name: 'data', mountPath: '/mnt/data', mode: 'rw' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.jobId).toBeTruthy();

    const rows = await Volume.findAll({ where: { containerId: provisioned.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');

    const jobs = await Job.findAll({ where: { status: 'pending' } });
    expect(jobs.some((j) => j.command.includes('reconfigure-container.js'))).toBe(true);
  });

  test('attaching on an unprovisioned container persists rows without a job', async () => {
    const res = await put(unprovisioned.id, {
      volumes: [{ name: 'data', mountPath: '/mnt/data', mode: 'rw' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.jobId).toBeNull();
    const rows = await Volume.findAll({ where: { containerId: unprovisioned.id } });
    expect(rows).toHaveLength(1);
  });

  test('detaching removes the row and enqueues a reconfigure job', async () => {
    const v = await Volume.create({
      containerId: provisioned.id,
      name: 'data',
      hostPath: '/v/prov/data',
      mountPath: '/mnt/data',
      mode: 'rw',
      status: 'ready',
    });
    const res = await put(provisioned.id, { volumes: [{ id: v.id, detach: true }] });
    expect(res.status).toBe(200);
    expect(res.body.data.jobId).toBeTruthy();
    expect(await Volume.findByPk(v.id)).toBeNull();
  });

  test('rejects an attach that collides with an existing volume mount', async () => {
    await Volume.create({
      containerId: provisioned.id,
      name: 'existing',
      hostPath: '/v/prov/existing',
      mountPath: '/mnt/data',
      mode: 'rw',
      status: 'ready',
    });
    const res = await put(provisioned.id, {
      volumes: [{ name: 'data', mountPath: '/mnt/data', mode: 'rw' }],
    });
    expect(res.status).toBe(409);
  });

  test('rejects the reserved quick_and_dirty mount path', async () => {
    const res = await put(provisioned.id, {
      volumes: [{ name: 'data', mountPath: '/mnt/quick_and_dirty', mode: 'rw' }],
    });
    expect(res.status).toBe(400);
  });
});
