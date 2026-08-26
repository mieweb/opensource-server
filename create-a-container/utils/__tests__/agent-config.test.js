/**
 * buildAgentConfig — the snapshot must carry Services.id on every http and
 * stream entry (the nginx accounting module reports last-access by service
 * id), and stay deterministic so the strong ETag is stable.
 */

const { resetDb, closeDb } = require('../../tests/helpers/db');
const {
  Site, Node, Container, Service, HTTPService, TransportService, ExternalDomain,
} = require('../../models');
const { buildAgentConfig, computeConfigEtag } = require('../agent-config');

describe('buildAgentConfig service ids', () => {
  let site;
  let httpSvc;
  let streamSvc;

  beforeEach(async () => {
    await resetDb();
    site = await Site.create({ name: 'test-site' });
    const node = await Node.create({ siteId: site.id, name: 'node1', nodeType: 'dummy' });
    const container = await Container.create({
      hostname: 'testct',
      username: 'tester',
      nodeId: node.id,
      siteId: site.id,
      ipv4Address: '10.254.1.5',
    });
    const domain = await ExternalDomain.create({ name: 'example.com' });

    httpSvc = await Service.create({ containerId: container.id, type: 'http', internalPort: 3000 });
    await HTTPService.create({
      serviceId: httpSvc.id,
      externalHostname: 'myapp',
      externalDomainId: domain.id,
    });

    streamSvc = await Service.create({ containerId: container.id, type: 'transport', internalPort: 22 });
    await TransportService.create({ serviceId: streamSvc.id, protocol: 'tcp', externalPort: 30022 });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('http and stream entries carry the Services.id', async () => {
    const config = await buildAgentConfig(site.id);
    expect(config.nginx.httpServices).toHaveLength(1);
    expect(config.nginx.httpServices[0].id).toBe(httpSvc.id);
    expect(config.nginx.streamServices).toHaveLength(1);
    expect(config.nginx.streamServices[0].id).toBe(streamSvc.id);
  });

  test('snapshot stays deterministic (stable ETag)', async () => {
    const etag1 = computeConfigEtag(await buildAgentConfig(site.id));
    const etag2 = computeConfigEtag(await buildAgentConfig(site.id));
    expect(etag1).toBe(etag2);
  });
});
