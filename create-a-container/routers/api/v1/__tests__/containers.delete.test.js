/**
 * DELETE /api/v1/sites/:siteId/containers/:id must not report success while
 * the VM may still be running: if the node-side delete fails, the record is
 * kept and 502 returned unless the VM is verifiably gone or `force=true`.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');
const { Site, Node, Container, ExternalDomain, Service, HTTPService } = require('../../../../models');
const DummyApi = require('../../../../utils/dummy-api');
const { manageDnsRecords } = require('../../../../utils/cloudflare-dns');

// Record DNS cleanup calls instead of talking to Cloudflare.
jest.mock('../../../../utils/cloudflare-dns', () => ({
  ...jest.requireActual('../../../../utils/cloudflare-dns'),
  manageDnsRecords: jest.fn(async () => []),
}));

describe('DELETE container: node-side failures', () => {
  let app;
  let key;
  let site;
  let node;
  let user;

  beforeAll(async () => {
    await resetDb();
    app = buildApp();
    await createUser({ uid: 'firstadmin' });
    user = await createUser({ uid: 'owner' });
    ({ plainKey: key } = await createApiKey(user));
    site = await Site.create({ name: 's', internalDomain: 'ex.test' });
    node = await Node.create({ siteId: site.id, name: 'n', nodeType: 'dummy' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    manageDnsRecords.mockClear();
  });
  afterAll(async () => {
    await closeDb();
  });

  let nextVmid = 4242;
  let vmid;
  // Each test's container gets its own VMID (unique per node).
  async function provisioned(hostname) {
    vmid = nextVmid++;
    return Container.create({ hostname, username: user.uid, nodeId: node.id, siteId: site.id, containerId: String(vmid) });
  }
  const del = (c, query = '') =>
    request(app).delete(`/api/v1/sites/${site.id}/containers/${c.id}${query}`).set(...bearer(key));

  function nodeDeleteFails({ stillListed }) {
    jest.spyOn(DummyApi.prototype, 'lxcConfig').mockResolvedValue({});
    jest.spyOn(DummyApi.prototype, 'deleteContainer').mockRejectedValue(new Error('storage locked'));
    jest
      .spyOn(DummyApi.prototype, 'clusterResources')
      .mockImplementation(async () => (stillListed ? [{ vmid, type: 'lxc' }] : []));
  }

  async function withHttpService(c) {
    const domain = await ExternalDomain.create({ name: `d${c.id}.example.test`, siteId: site.id });
    const svc = await Service.create({ containerId: c.id, type: 'http', internalPort: 80 });
    await HTTPService.create({ serviceId: svc.id, externalHostname: c.hostname, externalDomainId: domain.id });
  }

  test('VM still exists → 502, the record is kept, and DNS is untouched', async () => {
    nodeDeleteFails({ stillListed: true });
    const c = await provisioned('still-there');
    await withHttpService(c);
    const res = await del(c);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('node_delete_failed');
    expect(res.body.error.message).toMatch(/storage locked/);
    expect(await Container.findByPk(c.id)).not.toBeNull();
    expect(manageDnsRecords).not.toHaveBeenCalled();
  });

  test('VM already gone → success', async () => {
    nodeDeleteFails({ stillListed: false });
    const c = await provisioned('already-gone');
    const res = await del(c);
    expect(res.status).toBe(200);
    expect(await Container.findByPk(c.id)).toBeNull();
  });

  test('force=true removes the record regardless, and only then cleans up DNS', async () => {
    nodeDeleteFails({ stillListed: true });
    const c = await provisioned('forced');
    await withHttpService(c);
    const res = await del(c, '?force=true');
    expect(res.status).toBe(200);
    expect(manageDnsRecords).toHaveBeenCalledWith(expect.any(Array), expect.anything(), 'delete');
    expect(await Container.findByPk(c.id)).toBeNull();
  });

  test('a Proxmox task id is waited for, and a failed task is a failure', async () => {
    jest.spyOn(DummyApi.prototype, 'lxcConfig').mockResolvedValue({});
    jest.spyOn(DummyApi.prototype, 'deleteContainer').mockResolvedValue({ data: 'UPID:n:0001:delete' });
    const wait = jest.spyOn(DummyApi.prototype, 'waitForTask').mockRejectedValue(new Error('Task failed with status: error'));
    jest.spyOn(DummyApi.prototype, 'clusterResources').mockImplementation(async () => [{ vmid, type: 'lxc' }]);
    const c = await provisioned('task-fails');
    const res = await del(c);
    expect(wait).toHaveBeenCalledWith('n', 'UPID:n:0001:delete');
    expect(res.status).toBe(502);
    expect(await Container.findByPk(c.id)).not.toBeNull();
  });
});
