const { MailAccount, MailForward, MailSuppression, ExternalDomain, User, Setting } = require('../../models');

// Always loaded with the owning user, domain (incl. mail gates) and forwards
// so the serializer can compose the address, send/receive state and
// forwarding set.
const INCLUDES = [
  {
    model: ExternalDomain,
    as: 'domain',
    attributes: ['id', 'name', 'mailEnabled', 'mailDnsVerified', 'mailMxVerified'],
  },
  { model: User, as: 'owner', attributes: ['uidNumber', 'uid'] },
  { model: MailForward, as: 'forwards', attributes: ['address'] },
];

async function findAll(where = {}) {
  return MailAccount.findAll({ where, include: INCLUDES, order: [['createdAt', 'DESC']] });
}

async function findById(id) {
  return MailAccount.findByPk(id, { include: INCLUDES });
}

async function findByAddress(externalDomainId, localPart, { includeDeleted = false } = {}) {
  return MailAccount.findOne({
    where: { externalDomainId, localPart },
    paranoid: !includeDeleted,
  });
}

async function create(fields) {
  const account = await MailAccount.create(fields);
  return findById(account.id);
}

/** Replace an account's forwarding set (empty array clears it). */
async function replaceForwards(account, forwards, transaction) {
  await MailForward.destroy({ where: { mailAccountId: account.id }, transaction });
  await MailForward.bulkCreate(
    forwards.map((address) => ({ mailAccountId: account.id, address })),
    { transaction },
  );
}

/** Bring a soft-deleted account back under a fresh owner/credentials while
 *  keeping its id — and therefore its MailSuppressions. Forwards are cleared:
 *  they belonged to the previous owner. */
async function restore(account, fields) {
  return MailAccount.sequelize.transaction(async (transaction) => {
    const lockedAccount = await MailAccount.findByPk(account.id, {
      paranoid: false,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    await lockedAccount.restore({ transaction });
    await lockedAccount.update(fields, { transaction });
    await replaceForwards(lockedAccount, [], transaction);
    return MailAccount.findByPk(lockedAccount.id, { include: INCLUDES, transaction });
  });
}

/** `forwards` (optional) replaces the forwarding set atomically with the update. */
async function update(account, fields, forwards, { expectedOwnerUidNumber } = {}) {
  const updated = await MailAccount.sequelize.transaction(async (transaction) => {
    const lockedAccount = await MailAccount.findByPk(account.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lockedAccount || (expectedOwnerUidNumber !== undefined
      && lockedAccount.uidNumber !== expectedOwnerUidNumber)) {
      return false;
    }

    await lockedAccount.update(fields, { transaction });
    // Only skip when forwards is truly "not provided"; allow [] to clear.
    if (forwards !== undefined) await replaceForwards(lockedAccount, forwards, transaction);
    return true;
  });
  if (!updated) return null;
  return findById(account.id);
}

async function destroy(account) {
  // Paranoid model — soft delete. Suppressions survive so recreating the
  // address cannot shed its opt-outs (see service.createAccount).
  return account.destroy();
}

async function findDomain(id) {
  return ExternalDomain.findByPk(id);
}

async function findSendableDomains() {
  return ExternalDomain.findAll({
    where: { mailEnabled: true, mailDnsVerified: true },
    attributes: ['id', 'name'],
    order: [['name', 'ASC']],
  });
}

async function findSuppressions(mailAccountId) {
  return MailSuppression.findAll({
    where: { mailAccountId },
    order: [['createdAt', 'DESC']],
  });
}

async function findSuppression(mailAccountId, suppressionId) {
  return MailSuppression.findOne({ where: { id: suppressionId, mailAccountId } });
}

async function destroySuppression(suppression) {
  return suppression.destroy();
}

// Owner lookup by session uid (manifesto: cross-resource access moves behind
// the users service once resources/users/ exists).
async function findUserByUid(uid) {
  return User.findOne({ where: { uid } });
}

async function getSetting(key) {
  return Setting.get(key);
}

module.exports = {
  findAll,
  findById,
  findByAddress,
  create,
  restore,
  update,
  destroy,
  findDomain,
  findSendableDomains,
  findSuppressions,
  findSuppression,
  destroySuppression,
  findUserByUid,
  getSetting,
};
