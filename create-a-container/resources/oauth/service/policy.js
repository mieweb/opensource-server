/**
 * OAuth policy: the constants and pure validation rules the rest of the
 * service builds on. No I/O.
 */

const { ApiError } = require('../../../middlewares/api');

/**
 * The single scope. Tokens act as the user with the user's full permissions,
 * exactly like an API key; admin status is derived from group membership on
 * every request, never baked into the token.
 */
const SCOPE = 'manager';

const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 h
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 d, renewed on every rotation
const CODE_TTL_SEC = 60;
/** Dynamically registered clients that never got (or lost) a grant are removed after this. */
const UNUSED_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'];
const INTERACTIVE_GRANT_TYPES = ['authorization_code', 'refresh_token'];

// Schemes that must never be a redirect target, whatever the client says.
const FORBIDDEN_SCHEMES = new Set([
  'javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:', 'filesystem:',
  'ws:', 'wss:', 'ftp:', 'mailto:', 'tel:', 'sms:',
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/** Thrown for OAuth protocol errors; rendered as `{ error, error_description }`. */
function oauthError(code, description, status = 400) {
  return new ApiError(status, code, description);
}

function isLoopbackHttp(u) {
  return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
}

/**
 * Redirect URI registration policy:
 *   - https to any host;
 *   - http only to a loopback host (any port, RFC 8252 §7.3);
 *   - private-use custom schemes for native apps (vscode://, cursor://, ...).
 * No fragments, no dangerous schemes. A scheme allowlist would add nothing:
 * https to any host is allowed anyway, and the consent screen shows the
 * redirect target to the user.
 *
 * @returns {string|null} why the URI is rejected, or null when acceptable
 */
function redirectUriProblem(uri) {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048) return 'must be a non-empty string';
  let u;
  try {
    u = new URL(uri);
  } catch {
    return 'is not an absolute URI';
  }
  if (u.hash || uri.includes('#')) return 'must not contain a fragment';
  if (u.username || u.password) return 'must not contain credentials';
  if (FORBIDDEN_SCHEMES.has(u.protocol)) return `scheme ${u.protocol} is not allowed`;
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:') return isLoopbackHttp(u) ? null : 'http is only allowed for loopback hosts';
  if (!/^[a-z][a-z0-9+.-]*:$/.test(u.protocol)) return 'has an invalid scheme';
  return null;
}

/**
 * RFC 8707 `resource`: it must identify this manager (its origin, or any
 * path on it such as /mcp). Tokens are audienced to the origin either way;
 * see the resource README for why /mcp and /api/v1 share one audience.
 */
function isManagerResource(resource, origin) {
  let u;
  try {
    u = new URL(String(resource));
  } catch {
    return false;
  }
  return !u.hash && u.origin.toLowerCase() === origin;
}

/**
 * Registration rules applied before oidc-provider sees the request (it would
 * accept more: http redirects to any host for web clients, the
 * client_credentials grant, other response types).
 *
 * @param {object} meta validated RFC 7591 metadata
 * @throws ApiError (invalid_redirect_uri / invalid_client_metadata)
 */
function checkRegistration(meta) {
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    throw oauthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array');
  }
  if (uris.length > 20) throw oauthError('invalid_redirect_uri', 'too many redirect_uris');
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem) throw oauthError('invalid_redirect_uri', `redirect_uri ${JSON.stringify(String(uri).slice(0, 200))} ${problem}`);
  }
  const method = meta.token_endpoint_auth_method;
  if (method !== undefined && !AUTH_METHODS.includes(method)) {
    throw oauthError('invalid_client_metadata', `Unsupported token_endpoint_auth_method "${method}"`);
  }
  for (const g of meta.grant_types || []) {
    if (!INTERACTIVE_GRANT_TYPES.includes(g)) throw oauthError('invalid_client_metadata', `Unsupported grant_type "${g}"`);
  }
  if ((meta.response_types || []).some((t) => t !== 'code')) {
    throw oauthError('invalid_client_metadata', 'Only the "code" response_type is supported');
  }
}

module.exports = {
  SCOPE,
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  CODE_TTL_SEC,
  UNUSED_CLIENT_TTL_MS,
  AUTH_METHODS,
  INTERACTIVE_GRANT_TYPES,
  oauthError,
  redirectUriProblem,
  isManagerResource,
  checkRegistration,
};
