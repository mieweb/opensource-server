/**
 * Sharing drives SSH access. sshd inside a container calls
 * GET /api/v1/containers/:id/ssh-access/:username with the container's own
 * token; the answer is computed live from owner + collaborators. Owners/admins
 * mint that token via POST /containers/:id/ssh-access/token.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../tests/helpers/db');
const { Site, Node, Container, ContainerCollaborator } = require('../../../models');

afterAll(async () => {
  await closeDb();
});

describe('ssh-access', () => {
  let app;
  let owner, collaborator, stranger;
  let site, container, token;

  beforeEach(async () => {
    await resetDb();
    app = buildApp();
    // First user after resetDb is auto-promoted to admin; burn it.
    await createUser({ uid: 'admin0' });
    owner = await createUser({ uid: 'alice' });
    collaborator = await createUser({ uid: 'bob' });
    stranger = await createUser({ uid: 'carol' });
    site = await Site.create({ name: 'test', internalDomain: 'test.example' });
    const node = await Node.create({ name: 'pve1', siteId: site.id });
    container = await Container.create({
      hostname: 'ct1',
      username: owner.uid,
      nodeId: node.id,
      siteId: site.id,
      containerId: '101',
    });
    await ContainerCollaborator.create({ containerId: container.id, username: collaborator.uid });
    token = await container.rotateSshAccessToken();
  });

  const check = (user, tok = token) =>
    request(app).get(`/api/v1/containers/${container.id}/ssh-access/${user}`).set(...bearer(tok));

  test('owner and collaborator are allowed (204)', async () => {
    expect((await check('alice')).status).toBe(204);
    expect((await check('bob')).status).toBe(204);
  });

  test('anyone else is denied (403), even with a valid directory account', async () => {
    const res = await check('carol');
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('unsharing takes effect on the next check', async () => {
    await ContainerCollaborator.destroy({ where: { containerId: container.id, username: 'bob' } });
    expect((await check('bob')).status).toBe(403);
  });

  test('invalid usernames are rejected before lookup (400)', async () => {
    expect((await check('Bad;Name')).status).toBe(400);
    expect((await check('Alice')).status).toBe(400);
    expect((await check('a'.repeat(33))).status).toBe(400);
  });

  test('missing, wrong, or rotated tokens are unauthorized (401)', async () => {
    expect((await request(app).get(`/api/v1/containers/${container.id}/ssh-access/alice`)).status).toBe(401);
    expect((await check('alice', 'nope')).status).toBe(401);
    // A user API key is not a container token.
    const { plainKey } = await createApiKey(owner);
    expect((await check('alice', plainKey)).status).toBe(401);
    await container.rotateSshAccessToken();
    expect((await check('alice')).status).toBe(401);
  });

  test('unenrolled container (no token hash) never authenticates', async () => {
    await container.update({ sshAccessTokenHash: null });
    expect((await check('alice')).status).toBe(401);
  });

  describe('POST /containers/:id/ssh-access/token', () => {
    const mint = async (user) => {
      const { plainKey } = await createApiKey(user);
      return request(app)
        .post(`/api/v1/containers/${container.id}/ssh-access/token`)
        .set(...bearer(plainKey));
    };

    test('owner mints a token that works and invalidates the previous one', async () => {
      const res = await mint(owner);
      expect(res.status).toBe(201);
      expect(typeof res.body.data.token).toBe('string');
      expect((await check('alice', res.body.data.token)).status).toBe(204);
      expect((await check('alice', token)).status).toBe(401);
    });

    test('collaborator may not mint (403); stranger cannot see the container (404)', async () => {
      expect((await mint(collaborator)).status).toBe(403);
      expect((await mint(stranger)).status).toBe(404);
    });
  });
});

describe('Container SSH-access helpers', () => {
  test('reserved env keys cannot be set by users or defaults', () => {
    const out = Container.normalizeEnvVars({ FOO: 'bar', CONTAINER_SSH_TOKEN: 'x', CONTAINER_ID: '9' });
    expect(out).toEqual({ FOO: 'bar' });
  });

  test('buildLxcEnvConfig injects reserved keys only when a token is supplied', async () => {
    await resetDb();
    const c = Container.build({ id: 42, hostname: 'h', username: 'u', nodeId: 1, siteId: 1, environmentVars: JSON.stringify({ CONTAINER_ID: 'spoof', A: '1' }) });
    const without = await c.buildLxcEnvConfig();
    expect(Container.parseLxcEnvString(without.env, { keepReserved: true })).toEqual({ A: '1' });
    const with_ = await c.buildLxcEnvConfig({ sshAccessToken: 'tok' });
    expect(Container.parseLxcEnvString(with_.env, { keepReserved: true })).toEqual({ A: '1', CONTAINER_ID: '42', CONTAINER_SSH_TOKEN: 'tok' });
  });

  test('ensureSshAccessToken reuses a still-valid token from the current env, else rotates', async () => {
    await resetDb();
    await createUser({ uid: 'admin0' });
    const site = await Site.create({ name: 't2', internalDomain: 't2.example' });
    const node = await Node.create({ name: 'pve2', siteId: site.id });
    const c = await Container.create({ hostname: 'ct2', username: 'admin0', nodeId: node.id, siteId: site.id });
    const first = await c.ensureSshAccessToken(undefined);
    expect(await c.verifySshAccessToken(first)).toBe(true);
    const reused = await c.ensureSshAccessToken(`A=1\0CONTAINER_SSH_TOKEN=${first}`);
    expect(reused).toBe(first);
    const rotated = await c.ensureSshAccessToken('CONTAINER_SSH_TOKEN=stale');
    expect(rotated).not.toBe(first);
    expect(await c.verifySshAccessToken(first)).toBe(false);
  });
});
