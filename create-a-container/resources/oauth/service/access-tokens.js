/**
 * Validate a Bearer access token for a protected resource (/mcp, /api/v1).
 *
 * Reads the provider's record directly (keyed by SHA-256 of the token, see
 * adapter.js): one indexed lookup, no Provider instance needed.
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
  const row = await repo.findRecord('AccessToken', sha256(plain));
  if (!row) return unknown();
  const { exp, aud, accountId, grantId } = row.payload;
  if (!exp || exp * 1000 <= Date.now()) return invalid('The access token expired');
  if (expectedAudience && aud !== expectedAudience) {
    return invalid('The access token was issued for a different resource');
  }
  const user = await repo.findUserWithGroups(accountId);
  if (!user) return invalid('The token owner no longer exists');
  repo.touch('Grant', grantId).catch((err) => console.error('Failed to record OAuth grant use:', err));
  return { user, grantId };
}

module.exports = { authenticateAccessToken };
