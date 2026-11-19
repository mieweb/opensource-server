/**
 * Consent: what the consent page shows about a client, and recording the
 * user's approval as an oidc-provider Grant.
 */

const repo = require('../repository');
const { SCOPE } = require('./policy');

/** True for Client ID Metadata Document clients (client_id is an https URL). */
function isMetadataDocumentClient(clientId) {
  return typeof clientId === 'string' && clientId.startsWith('https://');
}

/** Scheme + host of a redirect target: what the user can judge on the consent page. */
function redirectDisplay(uri) {
  const u = new URL(uri);
  return `${u.protocol}//${u.host}`;
}

/**
 * Display info for a client, also stored with each grant so "Authorized apps"
 * can show metadata-document clients (which aren't persisted as clients).
 */
async function describeClient(provider, clientId) {
  const client = await provider.Client.find(clientId);
  return {
    clientId,
    clientName: client?.clientName || 'Unnamed application',
    registrationType: isMetadataDocumentClient(clientId) ? 'metadata_document' : 'dynamic',
    redirectUris: client?.redirectUris || [],
  };
}

/**
 * The user approved: grant the scope for every resource requested, and keep
 * the client's display info on the grant.
 *
 * @param {Provider} provider
 * @param {object} details interactionDetails() result
 * @param {string} uid manager username
 * @returns {Promise<string>} grantId
 */
async function approve(provider, details, uid) {
  const clientId = details.params.client_id;
  const grant = new provider.Grant({ accountId: uid, clientId });
  const { missingResourceScopes = {} } = details.prompt.details || {};
  grant.addOIDCScope(SCOPE);
  for (const indicator of Object.keys(missingResourceScopes)) grant.addResourceScope(indicator, SCOPE);
  const grantId = await grant.save();
  await repo.setMeta('Grant', grantId, await describeClient(provider, clientId));
  return grantId;
}

module.exports = { describeClient, approve, redirectDisplay, isMetadataDocumentClient };
