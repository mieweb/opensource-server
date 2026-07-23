/** Unit tests for the apikeys service — repository is mocked. */

jest.mock('../repository');

const repo = require('../repository');
const svc = require('../service');
const { ApiError } = require('../../../middlewares/api');

const user = { uid: 'alice', uidNumber: 3001 };

beforeEach(() => {
  jest.resetAllMocks();
  repo.findUserByUid.mockResolvedValue(user);
});

describe('apikeys service', () => {
  test('every operation rejects an unknown session user with 401', async () => {
    repo.findUserByUid.mockResolvedValue(null);
    for (const call of [
      () => svc.listKeys('ghost'),
      () => svc.getKey('ghost', 'x'),
      () => svc.createKey('ghost', {}),
      () => svc.deleteKey('ghost', 'x'),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    }
  });

  test('listKeys scopes to the resolved user', async () => {
    const rows = [{ id: 'k1' }];
    repo.findAllForUser.mockResolvedValue(rows);
    await expect(svc.listKeys('alice')).resolves.toBe(rows);
    expect(repo.findAllForUser).toHaveBeenCalledWith(user.uidNumber);
  });

  test('getKey throws ApiError 404 when the key is missing or not owned', async () => {
    repo.findForUser.mockResolvedValue(null);
    const err = await svc.getKey('alice', 'missing-id').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'not_found' });
    expect(repo.findForUser).toHaveBeenCalledWith('missing-id', user.uidNumber);
  });

  test('createKey stores prefix + hash (never the plaintext) and returns plainKey once', async () => {
    repo.create.mockImplementation(async (fields) => ({ id: 'new', ...fields }));
    const { key, plainKey } = await svc.createKey('alice', { description: 'ci' });

    expect(typeof plainKey).toBe('string');
    expect(plainKey).toHaveLength(43);
    const stored = repo.create.mock.calls[0][0];
    expect(stored.uidNumber).toBe(user.uidNumber);
    expect(stored.description).toBe('ci');
    expect(stored.keyPrefix).toBe(plainKey.substring(0, 8));
    expect(stored.keyHash).toMatch(/^\$argon2/);
    expect(Object.values(stored)).not.toContain(plainKey);
    expect(key.id).toBe('new');
  });

  test('deleteKey destroys only an owned key', async () => {
    const row = { id: 'k1' };
    repo.findForUser.mockResolvedValue(row);
    await svc.deleteKey('alice', 'k1');
    expect(repo.destroy).toHaveBeenCalledWith(row);

    repo.findForUser.mockResolvedValue(null);
    await expect(svc.deleteKey('alice', 'k2')).rejects.toMatchObject({ status: 404 });
    expect(repo.destroy).toHaveBeenCalledTimes(1);
  });
});
