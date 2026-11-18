/**
 * OAuth clients for the client_credentials grant (issue #518): created by a
 * user, acting as that user (resources/oauth/service/owned-clients.js). Users
 * manage their own; admins can list (`all`) and delete anyone's. Deleting a
 * client revokes every token issued to it.
 */

const oauth = require('../oauth/service');
const { ApiError } = require('../../middlewares/api');

/** @param {{ uid: string, isAdmin: boolean }} session */
function listClients(session, { all } = {}) {
  if (all && !session.isAdmin) throw new ApiError(403, 'forbidden', 'Admin access required');
  return oauth.listOwnedClients(all ? {} : { uid: session.uid });
}

function createClient(session, { name }) {
  return oauth.createOwnedClient(session.uid, name);
}

async function deleteClient(session, clientId) {
  const client = await oauth.findOwnedClient(clientId);
  // Someone else's client is a 404 for non-admins: don't reveal that it exists.
  if (!client || (!session.isAdmin && client.accountId !== session.uid)) {
    throw new ApiError(404, 'not_found', 'OAuth client not found');
  }
  await oauth.deleteOwnedClient(clientId);
}

module.exports = { listClients, createClient, deleteClient };
