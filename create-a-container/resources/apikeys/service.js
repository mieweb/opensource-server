const repo = require('./repository');
const { createApiKeyData } = require('../../utils/apikey');
const { ApiError } = require('../../middlewares/api');

async function requireUser(sessionUid) {
  const user = await repo.findUserByUid(sessionUid);
  if (!user) throw new ApiError(401, 'unauthorized', 'Session user not found');
  return user;
}

async function listKeys(sessionUid) {
  const user = await requireUser(sessionUid);
  return repo.findAllForUser(user.uidNumber);
}

async function getKey(sessionUid, id) {
  const user = await requireUser(sessionUid);
  const key = await repo.findForUser(id, user.uidNumber);
  if (!key) throw new ApiError(404, 'not_found', 'API key not found');
  return key;
}

/** Returns { key, plainKey } — plainKey is shown to the user exactly once. */
async function createKey(sessionUid, { description } = {}) {
  const user = await requireUser(sessionUid);
  const data = await createApiKeyData(user.uidNumber, description);
  const key = await repo.create({
    uidNumber: data.uidNumber,
    keyPrefix: data.keyPrefix,
    keyHash: data.keyHash,
    description: data.description,
  });
  return { key, plainKey: data.plainKey };
}

async function deleteKey(sessionUid, id) {
  const user = await requireUser(sessionUid);
  const key = await repo.findForUser(id, user.uidNumber);
  if (!key) throw new ApiError(404, 'not_found', 'API key not found');
  await repo.destroy(key);
}

module.exports = { listKeys, getKey, createKey, deleteKey };
