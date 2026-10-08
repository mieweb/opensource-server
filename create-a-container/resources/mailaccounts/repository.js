const { MailAccount, MailSuppression, ExternalDomain, User, Setting } = require('../../models');

// Always loaded with the owning user and domain (incl. mail gates) so the
// serializer can compose the address and send/receive state.
const INCLUDES = [
  {
    model: ExternalDomain,
    as: 'domain',
    attributes: ['id', 'name', 'mailEnabled', 'mailDnsVerified', 'mailMxVerified'],
  },
  { model: User, as: 'owner', attributes: ['uidNumber', 'uid'] },
];

async function findAll(where = {}) {
  return MailAccount.findAll({ where, include: INCLUDES, order: [['createdAt', 'DESC']] });
}

async function findById(id) {
  return MailAccount.findByPk(id, { include: INCLUDES });
}

async function findByAddress(externalDomainId, localPart) {
  return MailAccount.findOne({ where: { externalDomainId, localPart } });
}

async function create(fields) {
  const account = await MailAccount.create(fields);
  return findById(account.id);
}

async function update(account, fields) {
  await account.update(fields);
  return findById(account.id);
}

async function destroy(account) {
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
