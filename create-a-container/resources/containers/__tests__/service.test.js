/**
 * Tests for the minimal containers service seam (loadByIdForSession). DB-backed
 * because the behavior under test is query-driven: owner/shared visibility and
 * the manage (owner/admin) gate. This is the authorization other resources
 * (e.g. ssh-access mint) rely on, so it is pinned directly. A container is
 * identified by its globally unique id — no site is involved.
 */

const { resetDb, closeDb, createUser } = require('../../../tests/helpers/db');
const { Site, Node, Container, ContainerCollaborator } = require('../../../models');
const svc = require('../service');

afterAll(async () => {
  await closeDb();
});

describe('containers service · loadByIdForSession', () => {
  let owner, collaborator, stranger, site, container;

  beforeEach(async () => {
    await resetDb();
    await createUser({ uid: 'admin0' }); // first user auto-promoted; burn it
    owner = await createUser({ uid: 'alice' });
    collaborator = await createUser({ uid: 'bob' });
    stranger = await createUser({ uid: 'carol' });
    site = await Site.create({ name: 's1', internalDomain: 's1.example' });
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
    const c = await svc.loadByIdForSession(container.id, session('admin0', true));
    expect(c.id).toBe(container.id);
  });

  test('owner loads own container', async () => {
    const c = await svc.loadByIdForSession(container.id, session('alice'));
    expect(c.id).toBe(container.id);
  });

  test('collaborator loads a shared container (view)', async () => {
    const c = await svc.loadByIdForSession(container.id, session('bob'));
    expect(c.id).toBe(container.id);
  });

  test('stranger gets 404 (existence not leaked)', async () => {
    await expect(svc.loadByIdForSession(container.id, session('carol'))).rejects.toMatchObject({
      status: 404,
    });
  });

  test('unknown id 404s', async () => {
    await expect(svc.loadByIdForSession(999999, session('admin0', true))).rejects.toMatchObject({
      status: 404,
    });
  });

  test('requireManage: collaborator gets 403, owner/admin pass', async () => {
    await expect(
      svc.loadByIdForSession(container.id, session('bob'), { requireManage: true }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.loadByIdForSession(container.id, session('alice'), { requireManage: true }),
    ).resolves.toMatchObject({ id: container.id });
    await expect(
      svc.loadByIdForSession(container.id, session('admin0', true), { requireManage: true }),
    ).resolves.toMatchObject({ id: container.id });
  });
});
