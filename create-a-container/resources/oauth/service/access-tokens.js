/**
 * Validate a Bearer access token for a protected resource (/mcp, /api/v1).
 *
 * Reads the provider's records directly (keyed by SHA-256 of the token, see
 * adapter.js): an indexed lookup, no Provider instance needed. Covers user
 * tokens (AccessToken) and client-credentials tokens (ClientCredentials).
 *
 * Audience: every token is audienced to the manager origin it was issued on.
 * /mcp checks it against the request origin (`expectedAudience`). /api/v1
 * passes null: the MCP server forwards the caller's token to /api/v1 over its
 * configured API_BASE_URL (usually loopback), so the request origin there
 * isn't the public one. That's still the same resource server under the same
 * authorization server: a token stored in this manager's table was issued by
 * this manager for this manager.
 */

const repo = require('../repository');
const { sha256 } = require('./hash');

const invalid = (reason) => ({ error: 'invalid_token', reason });
/** Not one of our tokens at all (the caller may try other credential types). */
const unknown = () => ({ ...invalid('The access token is invalid or revoked'), unknown: true });

/**
 * @param {string} plain
 * @param {{ expectedAudience?: string|null }} [opts]
 * @returns {Promise<{ user, grantId } | { error: 'invalid_token', reason: string, unknown?: true }>}
 */
async function authenticateAccessToken(plain, { expectedAudience = null } = {}) {
  if (typeof plain !== 'string' || !plain) return unknown();
  const key = sha256(plain);
  const row = await repo.findRecord('AccessToken', key) || await repo.findRecord('ClientCredentials', key);
  if (!row) return unknown();
  const { exp, aud } = row.payload;
  if (!exp || exp * 1000 <= Date.now()) return invalid('The access token expired');
  if (expectedAudience && aud !== expectedAudience) {
    return invalid('The access token was issued for a different resource');
  }

  // A user's token names the user; a client-credentials token acts as the
  // client's owner (service/owned-clients.js).
  let uid;
  let used;
  if (row.model === 'AccessToken') {
    uid = row.payload.accountId;
    used = ['Grant', row.payload.grantId];
  } else {
    const client = await repo.findRecord('Client', row.payload.clientId);
    uid = client?.accountId;
    used = ['Client', row.payload.clientId];
  }
  const user = uid ? await repo.findUserWithGroups(uid) : null;
  if (!user) return invalid('The token owner no longer exists');
  repo.touch(...used).catch((err) => console.error('Failed to record OAuth token use:', err));
  return { user, grantId: row.payload.grantId || null };
}

module.exports = { authenticateAccessToken };
