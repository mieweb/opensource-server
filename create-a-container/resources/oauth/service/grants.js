/**
 * Grants as the rest of the app sees them ("Authorized apps"): one per
 * approval of a client by a user. Revoking deletes the grant and every token
 * and code issued under it.
 */

const repo = require('../repository');

/** @param {{ uid?: string }} [filter] only this user's grants */
function listGrants({ uid } = {}) {
  return repo.findGrants(uid ? { accountId: uid } : {});
}

function findGrant(id) {
  return repo.findRecord('Grant', id);
}

function revokeGrant(id) {
  return repo.destroyGrant(id);
}

module.exports = { listGrants, findGrant, revokeGrant };
