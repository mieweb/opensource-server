/**
 * PUT /api/v1/sites/:siteId/containers/:id with `username` — ownership
 * transfer by the owner or an admin.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');
const { Site, Node, Container, ContainerCollaborator, ResourceRequest } = require('../../../../models');

describe('PUT container ownership transfer', () => {
  let app;
  let site;
  let container;
  let adminKey;
  let owner;
  let ownerKey;
  let other;
  let otherKey;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    // First user after resetDb() is auto-promoted to sysadmins.
    const admin = await createUser({ admin: true });
    ({ plainKey: adminKey } = await createApiKey(admin));
    owner = await createUser();
    ({ plainKey: ownerKey } = await createApiKey(owner));
    other = await createUser();
    ({ plainKey: otherKey } = await createApiKey(other));
    site = await Site.create({ name: 's', internalDomain: 'ex.test' });
    const node = await Node.create({ siteId: site.id, name: 'n', nodeType: 'dummy' });
    container = await Container.create({
      hostname: 'box',
      username: owner.uid,
      nodeId: node.id,
      siteId: site.id,
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  function put(key, body) {
    return request(app)
      .put(`/api/v1/sites/${site.id}/containers/${container.id}`)
      .set(...bearer(key))
      .send(body);
  }

  test('the owner can transfer ownership and then loses access', async () => {
    const res = await put(ownerKey, { username: other.uid });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(`Ownership transferred to ${other.uid}`);
    await container.reload();
    expect(container.username).toBe(other.uid);

    const after = await request(app)
      .get(`/api/v1/sites/${site.id}/containers/${container.id}`)
      .set(...bearer(ownerKey));
    expect(after.status).toBe(404);
  });

  test('an admin can transfer a container they do not own', async () => {
    const res = await put(adminKey, { username: other.uid });
    expect(res.status).toBe(200);
    await container.reload();
    expect(container.username).toBe(other.uid);
  });

  test('a collaborator cannot transfer ownership', async () => {
    await ContainerCollaborator.create({ containerId: container.id, username: other.uid });
    const res = await put(otherKey, { username: other.uid });
    expect(res.status).toBe(403);
    await container.reload();
    expect(container.username).toBe(owner.uid);
  });

  test('rejects an unknown user', async () => {
    const res = await put(ownerKey, { username: 'nobody' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('user_not_found');
  });

  test('rejects an inactive user', async () => {
    const inactive = await createUser({ status: 'pending' });
    const res = await put(ownerKey, { username: inactive.uid });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('user_inactive');
  });

  test("removes the new owner's sharing grant", async () => {
    await ContainerCollaborator.create({ containerId: container.id, username: other.uid });
    const res = await put(ownerKey, { username: other.uid });
    expect(res.status).toBe(200);
    expect(await ContainerCollaborator.count({ where: { containerId: container.id } })).toBe(0);
  });

  test('moves resource requests to the new owner', async () => {
    await ResourceRequest.create({
      siteId: site.id,
      hostname: 'box',
      username: owner.uid,
      resourceType: 'memory',
      value: 16384,
      status: 'approved',
      reviewedAt: new Date(),
    });
    const res = await put(adminKey, { username: other.uid });
    expect(res.status).toBe(200);
    expect(await ResourceRequest.getApprovedResources(site.id, 'box', other.uid)).toEqual({ memory: 16384 });
    expect(await ResourceRequest.getApprovedResources(site.id, 'box', owner.uid)).toEqual({});
  });
});
