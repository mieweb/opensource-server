/** Sequelize queries over OAuthPayloads (oidc-provider records). No business rules. */

const { Op } = require('sequelize');
const { OAuthPayload, sequelize } = require('../../models');

const where = (model, id) => ({ model, id });

function findRecord(model, id) {
  return OAuthPayload.findOne({ where: where(model, id) });
}

function findRecordBy(model, column, value) {
  return OAuthPayload.findOne({ where: { model, [column]: value } });
}

/**
 * Insert or replace a record's provider-owned columns. `meta` and
 * `lastUsedAt` are app-owned and survive the provider's re-saves.
 */
async function upsertRecord(model, id, fields) {
  const existing = await findRecord(model, id);
  if (existing) return existing.update(fields);
  return OAuthPayload.create({ model, id, ...fields });
}

function destroyRecord(model, id) {
  return OAuthPayload.destroy({ where: where(model, id) });
}

/** Records of one model issued under a grant (adapter revokeByGrantId). */
function destroyModelByGrantId(model, grantId) {
  return OAuthPayload.destroy({ where: { model, grantId } });
}

/** Revoke a grant: every record issued under it, and the grant itself. */
function destroyGrant(grantId) {
  return sequelize.transaction(async (transaction) => {
    await OAuthPayload.destroy({ where: { grantId }, transaction });
    await OAuthPayload.destroy({ where: { model: 'Grant', id: grantId }, transaction });
  });
}

function setMeta(model, id, meta) {
  return OAuthPayload.update({ meta }, { where: where(model, id), silent: true });
}

function touch(model, id) {
  return OAuthPayload.update({ lastUsedAt: new Date() }, { where: where(model, id), silent: true });
}

/** Records past their expiry. */
function destroyExpired(now) {
  return OAuthPayload.destroy({ where: { expiresAt: { [Op.lt]: now } } });
}

/** Grants with no live token left (nothing can use or refresh them). */
async function destroyDeadGrants() {
  const grants = await OAuthPayload.findAll({ where: { model: 'Grant' }, attributes: ['id'] });
  const live = new Set((await OAuthPayload.findAll({
    where: { model: { [Op.in]: ['AccessToken', 'RefreshToken'] }, grantId: { [Op.ne]: null } },
    attributes: ['grantId'],
  })).map((t) => t.grantId));
  const dead = grants.map((g) => g.id).filter((id) => !live.has(id));
  if (dead.length) await OAuthPayload.destroy({ where: { model: 'Grant', id: dead } });
  return dead.length;
}

/** Dynamically registered clients created before `cutoff` that no grant refers to. */
async function destroyUnusedDynamicClients(cutoff) {
  const clients = await OAuthPayload.findAll({
    where: { model: 'Client', accountId: null, createdAt: { [Op.lt]: cutoff } },
    attributes: ['id'],
  });
  const used = new Set((await OAuthPayload.findAll({
    where: { model: 'Grant' }, attributes: ['clientId'],
  })).map((g) => g.clientId));
  const unused = clients.map((c) => c.id).filter((id) => !used.has(id));
  if (unused.length) await OAuthPayload.destroy({ where: { model: 'Client', id: unused } });
  return unused.length;
}

module.exports = {
  findRecord,
  findRecordBy,
  upsertRecord,
  destroyRecord,
  destroyModelByGrantId,
  destroyGrant,
  setMeta,
  touch,
  destroyExpired,
  destroyDeadGrants,
  destroyUnusedDynamicClients,
};
