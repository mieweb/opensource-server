/**
 * Volumes in the agent config snapshot (issue #421): buildAgentConfig must
 * advertise a container's non-builtin, host-path-resolved volumes at the SITE
 * level (one agent per site), and must exclude built-in and not-yet-derived
 * volumes. Verified independently of container IP (volumes must be advertised
 * during creation, before the container has an IP).
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

  test('advertises a resolved non-builtin volume at the site level', async () => {
    await Volume.create({
      containerId: container.id,
      name: 'data',
      hostPath: '/mnt/pve/cephfs/volumes/ct1/data',
      mountPath: '/mnt/data',
      mode: 'rw',
      status: 'pending',
    });

    const config = await buildAgentConfig(site.id);
    expect(config.site.volumes).toEqual([
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
    expect(config.site.volumes).toEqual([]);
  });

  test('excludes volumes on Docker nodes (Docker provisions its own binds)', async () => {
    const dockerNode = await Node.create({
      siteId: site.id,
      name: 'docker1',
      nodeType: 'docker',
      apiUrl: 'unix:///var/run/docker.sock',
    });
    const dockerCt = await Container.create({
      hostname: 'dct',
      username: 'tester',
      nodeId: dockerNode.id,
      siteId: site.id,
    });
    await Volume.create({
      containerId: dockerCt.id,
      name: 'data',
      hostPath: '/var/lib/opensource-server/volumes/site-1/dct/data',
      mountPath: '/mnt/data',
      mode: 'rw',
      status: 'ready',
    });

    const config = await buildAgentConfig(site.id);
    // The Docker-node volume must not be advertised to the site agent.
    expect(config.site.volumes).toEqual([]);
  });
});
