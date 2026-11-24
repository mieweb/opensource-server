jest.mock('../../../models', () => ({
  MailAccount: {
    sequelize: { transaction: jest.fn() },
    findByPk: jest.fn(),
  },
  MailForward: {
    destroy: jest.fn(),
    bulkCreate: jest.fn(),
  },
}));

const { MailAccount, MailForward } = require('../../../models');
const repo = require('../repository');

const transaction = { LOCK: { UPDATE: 'UPDATE' } };

beforeEach(() => {
  jest.resetAllMocks();
  MailAccount.sequelize.transaction.mockImplementation((work) => work(transaction));
});

describe('update', () => {
  test('locks and reloads the account before checking ownership', async () => {
    const staleAccount = { id: 'account-id', uidNumber: 1 };
    const currentAccount = { id: staleAccount.id, uidNumber: 2, update: jest.fn() };
    MailAccount.findByPk.mockResolvedValueOnce(currentAccount);

    await expect(repo.update(
      staleAccount,
      {},
      ['destination@example.net'],
      { expectedOwnerUidNumber: 1 },
    )).resolves.toBeNull();

    expect(MailAccount.findByPk).toHaveBeenCalledWith(staleAccount.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    expect(currentAccount.update).not.toHaveBeenCalled();
    expect(MailForward.destroy).not.toHaveBeenCalled();
    expect(MailForward.bulkCreate).not.toHaveBeenCalled();
  });
});

test('restore locks the row before resetting forwards', async () => {
  const account = {
    id: 'account-id',
    restore: jest.fn(),
    update: jest.fn(),
  };
  const restoredAccount = { id: account.id };
  MailAccount.findByPk
    .mockResolvedValueOnce(account)
    .mockResolvedValueOnce(restoredAccount);

  await repo.restore(account, { uidNumber: 2 });

  expect(MailAccount.findByPk).toHaveBeenNthCalledWith(1, account.id, {
    paranoid: false,
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  expect(account.restore).toHaveBeenCalledWith({ transaction });
  expect(MailForward.destroy).toHaveBeenCalledWith({
    where: { mailAccountId: account.id },
    transaction,
  });
  expect(MailForward.bulkCreate).toHaveBeenCalledWith([], { transaction });
});
