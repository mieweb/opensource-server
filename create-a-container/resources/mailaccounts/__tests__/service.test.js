/**
 * Unit tests for the mail-accounts service — repository mocked per the MVC
 * manifesto. Covers the #67 guardrails: one-time passwords, Argon2id p=1
 * hashes, reserved local parts, the domain can-send gate, and admin-only
 * quota/transfer/suppression-removal.
 */

jest.mock('../repository');

const repo = require('../repository');
const svc = require('../service');

const user = { uidNumber: 3001, uid: 'alice', status: 'active' };
const admin = { uidNumber: 3000, uid: 'root-admin', status: 'active' };
const sendableDomain = { id: 1, name: 'example.com', mailEnabled: true, mailDnsVerified: true };
const disabledDomain = { id: 2, name: 'off.example', mailEnabled: false, mailDnsVerified: false };

const session = { uid: 'alice', isAdmin: false };
const adminSession = { uid: 'root-admin', isAdmin: true };

function accountRow(overrides = {}) {
  return {
    id: '7d9fb37e-0000-4000-8000-000000000001',
    uidNumber: user.uidNumber,
    localPart: 'app',
    domain: sendableDomain,
    owner: user,
    quotaBytes: 1024 * 1024 * 1024,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  repo.findUserByUid.mockImplementation(async (uid) => {
    if (uid === 'alice') return user;
    if (uid === 'root-admin') return admin;
    return null;
  });
  repo.getSetting.mockResolvedValue(null);
  repo.findDomain.mockResolvedValue(sendableDomain);
  repo.findByAddress.mockResolvedValue(null);
  repo.create.mockImplementation(async (fields) => accountRow(fields));
  repo.update.mockImplementation(async (account, fields) => ({ ...account, ...fields }));
});

describe('createAccount', () => {
  test('returns the password once and stores only an Argon2id p=1 hash', async () => {
    const { account, password, connection } = await svc.createAccount(session, {
      externalDomainId: 1,
      localPart: 'app',
    });
    expect(password).toHaveLength(43); // 32 bytes base64url
    const stored = repo.create.mock.calls[0][0];
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).toMatch(/p=1[,$]/);
    expect(Object.values(stored)).not.toContain(password);
    // Default quota applies when no setting and no quotaMb given.
    expect(stored.quotaBytes).toBe(1024 * 1024 * 1024);
    expect(account.uidNumber).toBe(user.uidNumber);
    expect(connection.username).toBe('app@example.com');
    expect(connection.smtp.ports).toEqual([587, 465]);
  });

  test('rejects domains that cannot send', async () => {
    repo.findDomain.mockResolvedValue(disabledDomain);
    await expect(svc.createAccount(session, { externalDomainId: 2, localPart: 'app' }))
      .rejects.toMatchObject({ status: 422, code: 'domain_cannot_send' });
  });

  test('reserves role local parts for admins', async () => {
    await expect(svc.createAccount(session, { externalDomainId: 1, localPart: 'postmaster' }))
      .rejects.toMatchObject({ status: 403, code: 'reserved_local_part' });
    await expect(svc.createAccount(adminSession, { externalDomainId: 1, localPart: 'postmaster' }))
      .resolves.toBeTruthy();
  });

  test('rejects duplicate addresses with 409', async () => {
    repo.findByAddress.mockResolvedValue(accountRow());
    await expect(svc.createAccount(session, { externalDomainId: 1, localPart: 'app' }))
      .rejects.toMatchObject({ status: 409, code: 'address_taken' });
  });

  test('only admins can set a quota at create', async () => {
    await expect(svc.createAccount(session, { externalDomainId: 1, localPart: 'app', quotaMb: 10 }))
      .rejects.toMatchObject({ status: 403, code: 'admin_required' });
    await svc.createAccount(adminSession, { externalDomainId: 1, localPart: 'app', quotaMb: 10 });
    expect(repo.create.mock.calls[0][0].quotaBytes).toBe(10 * 1024 * 1024);
  });
});

describe('updateAccount', () => {
  test('owner can toggle enabled/unsubscribeHeaders but not quota or transfer', async () => {
    repo.findById.mockResolvedValue(accountRow());
    await svc.updateAccount(session, 'x-id', { enabled: false, unsubscribeHeaders: false });
    expect(repo.update.mock.calls[0][1]).toEqual({ enabled: false, unsubscribeHeaders: false });

    await expect(svc.updateAccount(session, 'x-id', { quotaMb: 5 }))
      .rejects.toMatchObject({ status: 403, code: 'admin_required' });
    await expect(svc.updateAccount(session, 'x-id', { username: 'bob' }))
      .rejects.toMatchObject({ status: 403, code: 'admin_required' });
  });

  test('admin transfer resolves the target user and rejects inactive users', async () => {
    repo.findById.mockResolvedValue(accountRow());
    repo.findUserByUid.mockImplementation(async (uid) => {
      if (uid === 'root-admin') return admin;
      if (uid === 'bob') return { uidNumber: 3002, uid: 'bob', status: 'active' };
      if (uid === 'carol') return { uidNumber: 3003, uid: 'carol', status: 'disabled' };
      return null;
    });
    await svc.updateAccount(adminSession, 'x-id', { username: 'bob' });
    expect(repo.update.mock.calls[0][1]).toEqual({ uidNumber: 3002 });

    await expect(svc.updateAccount(adminSession, 'x-id', { username: 'carol' }))
      .rejects.toMatchObject({ status: 422, code: 'user_inactive' });
    await expect(svc.updateAccount(adminSession, 'x-id', { username: 'nobody' }))
      .rejects.toMatchObject({ status: 404, code: 'user_not_found' });
  });

  test('non-owner non-admin gets a 404 (existence hidden)', async () => {
    repo.findById.mockResolvedValue(accountRow({ uidNumber: 9999 }));
    await expect(svc.updateAccount(session, 'x-id', { enabled: false }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('rotatePassword', () => {
  test('returns a fresh password and stores a new hash + lastRotatedAt', async () => {
    repo.findById.mockResolvedValue(accountRow());
    const { password } = await svc.rotatePassword(session, 'x-id');
    expect(password).toHaveLength(43);
    const fields = repo.update.mock.calls[0][1];
    expect(fields.passwordHash).toMatch(/^\$argon2id\$/);
    expect(fields.lastRotatedAt).toBeInstanceOf(Date);
  });
});

describe('suppressions', () => {
  test('owner can list but only admins can remove', async () => {
    repo.findById.mockResolvedValue(accountRow());
    repo.findSuppressions.mockResolvedValue([]);
    await expect(svc.listSuppressions(session, 'x-id')).resolves.toEqual([]);

    await expect(svc.removeSuppression(session, 'x-id', 1))
      .rejects.toMatchObject({ status: 403, code: 'admin_required' });

    repo.findSuppression.mockResolvedValue({ id: 1 });
    repo.destroySuppression.mockResolvedValue();
    await svc.removeSuppression(adminSession, 'x-id', 1);
    expect(repo.destroySuppression).toHaveBeenCalled();
  });
});
