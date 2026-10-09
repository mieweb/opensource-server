/**
 * DELETE /api/v1/sites/:siteId/containers/:id must not report success while
 * the VM may still be running: if the node-side delete fails, the record is
 * kept and 502 returned unless the VM is verifiably gone or `force=true`.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');
const { Site, Node, Container, ExternalDomain, Service, HTTPService, Job } = require('../../../../models');
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
  let adminKey;

  beforeAll(async () => {
    await resetDb();
    app = buildApp();
    const admin = await createUser({ uid: 'firstadmin' }); // first user: auto-promoted to admin
    ({ plainKey: adminKey } = await createApiKey(admin));
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
  const del = (c, query = '', as = key) =>
    request(app).delete(`/api/v1/sites/${site.id}/containers/${c.id}${query}`).set(...bearer(as));

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

  test('a container whose create job is still running is not deleted (409)', async () => {
    const job = await Job.create({ command: 'node bin/create-container.js', createdBy: user.uid, status: 'running' });
    const c = await Container.create({ hostname: 'creating', username: user.uid, nodeId: node.id, siteId: site.id, creationJobId: job.id });
    const res = await del(c, '?force=true');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('create_in_progress');
    expect(await Container.findByPk(c.id)).not.toBeNull();
    await job.update({ status: 'failure' });
    expect((await del(c)).status).toBe(200);
  });

  test('...even once the create job has recorded a VMID', async () => {
    const job = await Job.create({ command: 'node bin/create-container.js', createdBy: user.uid, status: 'running' });
    const c = await Container.create({
      hostname: 'creating-with-id',
      username: user.uid,
      nodeId: node.id,
      siteId: site.id,
      containerId: '7777',
      creationJobId: job.id,
    });
    const res = await del(c, '?force=true');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('create_in_progress');
    expect(await Container.findByPk(c.id)).not.toBeNull();
  });

  test('VM already gone → success', async () => {
    nodeDeleteFails({ stillListed: false });
    const c = await provisioned('already-gone');
    const res = await del(c);
    expect(res.status).toBe(200);
    expect(await Container.findByPk(c.id)).toBeNull();
  });

  test('an owner cannot force-remove the record of a VM that may still be running', async () => {
    nodeDeleteFails({ stillListed: true });
    const c = await provisioned('owner-forced');
    const res = await del(c, '?force=true');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Only an administrator/);
    expect(await Container.findByPk(c.id)).not.toBeNull();
    expect(manageDnsRecords).not.toHaveBeenCalled();
  });

  test('force=true (admin) removes the record regardless, and only then cleans up DNS', async () => {
    nodeDeleteFails({ stillListed: true });
    const c = await provisioned('forced');
    await withHttpService(c);
    const res = await del(c, '?force=true', adminKey);
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
