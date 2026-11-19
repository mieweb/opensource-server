/**
 * Clients for the client_credentials grant (issue #518), created by a user on
 * the API keys page. A token issued to one acts as that user, bounded by the
 * user's permissions (admin status still derived from group membership per
 * request), exactly like an API key. The owner is stored in the row's
 * `accountId` column, never in client metadata, so nothing a client sends can
 * claim one.
 *
 * Stored as an oidc-provider Client record, so the provider authenticates it
 * at /oauth/token like any other client.
 */

const crypto = require('crypto');
const repo = require('../repository');
const { hashSecret } = require('./hash');
const { SCOPE } = require('./policy');

/**
 * @param {string} uid owner's username
 * @param {string} name
 * @returns {Promise<{ client, clientSecret: string }>} the row, and the secret (shown once)
 */
async function createOwnedClient(uid, name) {
  const clientId = `mcp_${crypto.randomBytes(18).toString('base64url')}`;
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const client = await repo.createRecord('Client', clientId, {
    clientId,
    accountId: uid,
    payload: {
      client_id: clientId,
      client_secret: hashSecret(clientSecret),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      grant_types: ['client_credentials'],
      response_types: [],
      redirect_uris: [],
      token_endpoint_auth_method: 'client_secret_basic',
      scope: SCOPE,
    },
  });
  return { client, clientSecret };
}

/** @param {{ uid?: string }} [filter] only this user's clients */
function listOwnedClients({ uid } = {}) {
  return repo.findOwnedClients(uid ? { accountId: uid } : {});
}

async function findOwnedClient(clientId) {
  const row = await repo.findRecord('Client', clientId);
  return row && row.accountId ? row : null;
}

/** Deleting the client also revokes every token issued to it. */
function deleteOwnedClient(clientId) {
  return repo.destroyClient(clientId);
}

module.exports = { createOwnedClient, listOwnedClients, findOwnedClient, deleteOwnedClient };
