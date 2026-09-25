/**
 * Agent check-in volume results (issue #421): the agent reports per-volume
 * directory-provisioning results keyed by Volume id; the manager writes them
 * into Volume.status (ready/failed) with statusMessage/appliedAt. Built-in
 * volumes are never flipped by an agent report.
 */

const request = require('supertest');
const { buildApp } = require('../../../../tests/helpers/app');
const { resetDb, closeDb } = require('../../../../tests/helpers/db');
const { Site, Node, Container, Volume } = require('../../../../models');

describe('POST /api/v1/agents volume results', () => {
  let app;
  let site;
  let readyVol;
  let failVol;
  let builtinVol;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    site = await Site.create({ name: 's1', internalDomain: 'example.test' });
    const node = await Node.create({ siteId: site.id, name: 'n1', nodeType: 'dummy' });
    const container = await Container.create({
      hostname: 'ct1',
      username: 'tester',
      nodeId: node.id,
      siteId: site.id,
    });
    readyVol = await Volume.create({
      containerId: container.id,
      name: 'data',
      hostPath: '/v/ct1/data',
      mountPath: '/mnt/data',
      mode: 'rw',
      status: 'pending',
    });
    failVol = await Volume.create({
      containerId: container.id,
      name: 'logs',
      hostPath: '/v/ct1/logs',
      mountPath: '/mnt/logs',
      mode: 'rw',
      status: 'pending',
    });
    builtinVol = await Volume.create({
      containerId: container.id,
      name: 'quick_and_dirty',
      hostPath: '/v/quick_and_dirty',
      mountPath: '/mnt/quick_and_dirty',
      mode: 'ro',
      builtin: true,
      status: 'ready',
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('applied=true -> ready, applied=false -> failed with message; built-in untouched', async () => {
    const res = await request(app)
      .post('/api/v1/agents')
      .send({
        siteId: site.id,
        hostname: 'n1',
        volumes: {
          [readyVol.id]: { applied: true },
          [failVol.id]: { applied: false, message: 'mkdir: permission denied' },
          [builtinVol.id]: { applied: false, message: 'should be ignored' },
        },
      });
    expect(res.status).toBe(200);

    await readyVol.reload();
    await failVol.reload();
    await builtinVol.reload();

    expect(readyVol.status).toBe('ready');
    expect(readyVol.appliedAt).toBeTruthy();
    expect(failVol.status).toBe('failed');
    expect(failVol.statusMessage).toBe('mkdir: permission denied');
    // Built-in volume is not flipped by an agent report.
    expect(builtinVol.status).toBe('ready');
  });

  test('a check-in cannot flip a volume belonging to another site', async () => {
    // A second site with its own container + pending volume.
    const site2 = await Site.create({ name: 's2', internalDomain: 'other.test' });
    const node2 = await Node.create({ siteId: site2.id, name: 'n2', nodeType: 'dummy' });
    const container2 = await Container.create({
      hostname: 'ct2',
      username: 'tester',
      nodeId: node2.id,
      siteId: site2.id,
    });
    const otherVol = await Volume.create({
      containerId: container2.id,
      name: 'data',
      hostPath: '/v/ct2/data',
      mountPath: '/mnt/data',
      mode: 'rw',
      status: 'pending',
    });

    // site 1's agent reports a result for site 2's volume id — must be ignored.
    const res = await request(app)
      .post('/api/v1/agents')
      .send({ siteId: site.id, hostname: 'n1', volumes: { [otherVol.id]: { applied: true } } });
    expect(res.status).toBe(200);

    await otherVol.reload();
    expect(otherVol.status).toBe('pending');
  });
});
