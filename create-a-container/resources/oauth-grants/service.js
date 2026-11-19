/**
 * "Authorized apps": the OAuth grants a user gave MCP clients (issue #514).
 * Users see and revoke their own; admins may list (`all`) and revoke anyone's.
 * Revoking deletes the grant and its tokens, so the client's next /mcp
 * request gets 401. Grants are stored by the OAuth resource; this goes
 * through its service.
 */

const oauth = require('../oauth/service');
const { ApiError } = require('../../middlewares/api');

/** @param {{ uid: string, isAdmin: boolean }} session */
function listGrants(session, { all } = {}) {
  if (all && !session.isAdmin) throw new ApiError(403, 'forbidden', 'Admin access required');
  return oauth.listGrants(all ? {} : { uid: session.uid });
}

async function revokeGrant(session, id) {
  const grant = await oauth.findGrant(id);
  // Someone else's grant is a 404 for non-admins: don't reveal that it exists.
  if (!grant || (!session.isAdmin && grant.accountId !== session.uid)) {
    throw new ApiError(404, 'not_found', 'Authorized app not found');
  }
  await oauth.revokeGrant(id);
}

module.exports = { listGrants, revokeGrant };
