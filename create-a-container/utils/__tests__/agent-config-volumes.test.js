/**
 * Volumes in the agent config snapshot (issue #421): buildAgentConfig must
 * advertise a container's non-builtin, host-path-resolved volumes on the node
 * that hosts the container, with the owning id-mapped UID/GID, and must exclude
 * built-in and not-yet-derived volumes. Verified independently of container IP
 * (volumes must be advertised during creation, before the container has an IP).
 */

const { resetDb, closeDb } = require('../../tests/helpers/db');
const { Site, Node, Container, Volume } = require('../../models');
const { buildAgentConfig } = require('../agent-config');

describe('buildAgentConfig volumes', () => {
  let site;
  let node;
  let container;

  beforeEach(async () => {
    await resetDb();
    site = await Site.create({ name: 'vol-site', internalDomain: 'example.test' });
    node = await Node.create({ siteId: site.id, name: 'node1', nodeType: 'dummy' });
    // No ipv4Address on purpose: volumes must still be advertised.
    container = await Container.create({
      hostname: 'ct1',
      username: 'tester',
      nodeId: node.id,
      siteId: site.id,
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('advertises a resolved non-builtin volume on the owning node with uid/gid', async () => {
    await Volume.create({
      containerId: container.id,
      name: 'data',
      hostPath: '/mnt/pve/cephfs/volumes/ct1/data',
      mountPath: '/mnt/data',
      mode: 'rw',
      status: 'pending',
    });

    const config = await buildAgentConfig(site.id);
    const nodeEntry = config.site.nodes.find((n) => n.name === 'node1');
    expect(nodeEntry.volumes).toEqual([
      {
        id: expect.any(Number),
        hostPath: '/mnt/pve/cephfs/volumes/ct1/data',
        mode: 'rw',
        uid: 100000,
        gid: 100000,
      },
    ]);
  });

  test('excludes built-in and host-path-less volumes', async () => {
    await Volume.create({
      containerId: container.id,
      name: 'quick_and_dirty',
      hostPath: '/mnt/pve/cephfs/volumes/quick_and_dirty',
      mountPath: '/mnt/quick_and_dirty',
      mode: 'ro',
      builtin: true,
      status: 'ready',
    });
    await Volume.create({
      containerId: container.id,
      name: 'notyet',
      hostPath: null,
      mountPath: '/mnt/notyet',
      mode: 'rw',
      status: 'pending',
    });

    const config = await buildAgentConfig(site.id);
    const nodeEntry = config.site.nodes.find((n) => n.name === 'node1');
    expect(nodeEntry.volumes).toEqual([]);
  });
});
