const { ApiKey, User } = require('../../models');

const LIST_ATTRS = ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt'];

async function findAllForUser(uidNumber) {
  return ApiKey.findAll({
    where: { uidNumber },
    order: [['createdAt', 'DESC']],
    attributes: LIST_ATTRS,
  });
}

async function findForUser(id, uidNumber) {
  return ApiKey.findOne({ where: { id, uidNumber }, attributes: LIST_ATTRS });
}

async function create(fields, options = {}) {
  return ApiKey.create(fields, options);
}

async function destroy(apiKey) {
  return apiKey.destroy();
}

// Owner lookup by session uid. Lives here until resources/users/ exists;
// then it moves behind the users service (manifesto §3: cross-resource
// access goes service-to-service).
async function findUserByUid(uid) {
  return User.findOne({ where: { uid } });
}

module.exports = { findAllForUser, findForUser, create, destroy, findUserByUid };
