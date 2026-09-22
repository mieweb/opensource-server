/**
 * Unit tests for the ssh-access service. The repository is mocked so these are
 * pure logic tests (no DB): token authentication and the owner/collaborator
 * allow decision.
 */

jest.mock('../repository');
const repo = require('../repository');
jest.mock('../../containers/service');
const containersService = require('../../containers/service');
const svc = require('../service');

// Minimal container stand-in: only what the service touches.
function fakeContainer({ id = 1, hostname = 'ct1', username = 'alice', collaborators = [], hash = 'h' } = {}) {
  return {
    id,
    hostname,
    username,
    collaborators: collaborators.map((u) => ({ username: u })),
    sshAccessTokenHash: hash,
    sshAllowsUser(u) {
      return this.username === u || this.collaborators.some((c) => c.username === u);
    },
    verifySshAccessToken: jest.fn(async (t) => hash !== null && t === 'good'),
  };
}

afterEach(() => jest.clearAllMocks());

describe('authenticateContainer', () => {
  test('returns the container when the token verifies', async () => {
    const c = fakeContainer();
    repo.findWithCollaborators.mockResolvedValue(c);
    await expect(svc.authenticateContainer(1, 'good')).resolves.toBe(c);
  });

  test('401 when no token is presented (no DB lookup)', async () => {
    await expect(svc.authenticateContainer(1, '')).rejects.toMatchObject({ status: 401 });
    expect(repo.findWithCollaborators).not.toHaveBeenCalled();
  });

  test('401 when the container is not found', async () => {
    repo.findWithCollaborators.mockResolvedValue(null);
    await expect(svc.authenticateContainer(9, 'good')).rejects.toMatchObject({ status: 401 });
  });

  test('401 when the token does not match', async () => {
    repo.findWithCollaborators.mockResolvedValue(fakeContainer());
    await expect(svc.authenticateContainer(1, 'wrong')).rejects.toMatchObject({ status: 401 });
  });
});

describe('assertUserAllowed', () => {
  test('allows the owner', () => {
    expect(() => svc.assertUserAllowed(fakeContainer({ username: 'alice' }), 'alice')).not.toThrow();
  });

  test('allows a collaborator', () => {
    expect(() =>
      svc.assertUserAllowed(fakeContainer({ collaborators: ['bob'] }), 'bob'),
    ).not.toThrow();
  });

  test('403 for anyone else', () => {
    expect(() => svc.assertUserAllowed(fakeContainer(), 'carol')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});

describe('mintToken', () => {
  test('delegates authorization to the containers service and rotates the token', async () => {
    const container = { id: 7, rotateSshAccessToken: jest.fn(async () => 'plain-tok') };
    containersService.loadForSession.mockResolvedValue({ container });

    const result = await svc.mintToken('1', 7, { user: 'alice', isAdmin: false });

    expect(containersService.loadForSession).toHaveBeenCalledWith(
      '1',
      7,
      { user: 'alice', isAdmin: false },
      { requireManage: true },
    );
    expect(container.rotateSshAccessToken).toHaveBeenCalled();
    expect(result).toEqual({ containerId: 7, token: 'plain-tok' });
  });

  test('propagates the containers service authorization error (does not rotate)', async () => {
    containersService.loadForSession.mockRejectedValue(
      Object.assign(new Error('forbidden'), { status: 403 }),
    );
    await expect(svc.mintToken('1', 7, { user: 'bob', isAdmin: false })).rejects.toMatchObject({
      status: 403,
    });
  });
});
