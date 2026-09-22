/**
 * Tests for the minimal containers service seam (loadForSession). DB-backed
 * because the behavior under test is query-driven: owner/shared visibility,
 * site-scoping, and the manage (owner/admin) gate. This is the authorization
 * other resources (e.g. ssh-access mint) rely on, so it is pinned directly.
 */

const { resetDb, closeDb, createUser } = require('../../../tests/helpers/db');
const { Site, Node, Container, ContainerCollaborator } = require('../../../models');
const svc = require('../service');

afterAll(async () => {
  await closeDb();
});

describe('containers service · loadForSession', () => {
  let owner, collaborator, stranger, site, otherSite, container;

  beforeEach(async () => {
    await resetDb();
    await createUser({ uid: 'admin0' }); // first user auto-promoted; burn it
    owner = await createUser({ uid: 'alice' });
    collaborator = await createUser({ uid: 'bob' });
    stranger = await createUser({ uid: 'carol' });
    site = await Site.create({ name: 's1', internalDomain: 's1.example' });
    otherSite = await Site.create({ name: 's2', internalDomain: 's2.example' });
    const node = await Node.create({ name: 'pve1', siteId: site.id });
    container = await Container.create({
      hostname: 'ct1',
      username: owner.uid,
      nodeId: node.id,
      siteId: site.id,
      containerId: '101',
    });
    await ContainerCollaborator.create({ containerId: container.id, username: collaborator.uid });
  });

  const session = (uid, isAdmin = false) => ({ user: uid, isAdmin });

  test('admin loads any container', async () => {
    const { container: c } = await svc.loadForSession(site.id, container.id, session('admin0', true));
    expect(c.id).toBe(container.id);
  });

  test('owner loads own container', async () => {
    const { container: c } = await svc.loadForSession(site.id, container.id, session('alice'));
    expect(c.id).toBe(container.id);
  });

  test('collaborator loads a shared container (view)', async () => {
    const { container: c } = await svc.loadForSession(site.id, container.id, session('bob'));
    expect(c.id).toBe(container.id);
  });

  test('stranger gets 404 (existence not leaked)', async () => {
    await expect(svc.loadForSession(site.id, container.id, session('carol'))).rejects.toMatchObject({
      status: 404,
    });
  });

  test('requireManage: collaborator gets 403, owner/admin pass', async () => {
    await expect(
      svc.loadForSession(site.id, container.id, session('bob'), { requireManage: true }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.loadForSession(site.id, container.id, session('alice'), { requireManage: true }),
    ).resolves.toMatchObject({ container: expect.objectContaining({ id: container.id }) });
    await expect(
      svc.loadForSession(site.id, container.id, session('admin0', true), { requireManage: true }),
    ).resolves.toMatchObject({ container: expect.objectContaining({ id: container.id }) });
  });

  test('wrong site 404s (no cross-site leak) even for the owner', async () => {
    await expect(
      svc.loadForSession(otherSite.id, container.id, session('alice')),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('unknown site 404s with site_not_found', async () => {
    await expect(svc.loadForSession(999999, container.id, session('alice'))).rejects.toMatchObject({
      status: 404,
      code: 'site_not_found',
    });
  });
});
