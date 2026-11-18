/**
 * API v1 middleware — JSON-only auth, CSRF, error handling, request helpers.
 *
 * Response shape contract:
 *   success: { data: <payload>, meta?: { ... } }
 *   error:   { error: { code: string, message: string, fields?: { [name]: string } } }
 */

const { csrfSync } = require('csrf-sync');

// --- CSRF (synchroniser token) ------------------------------------------------------------
// Token is generated server-side, stored in the session (req.session.csrfToken),
// and must be echoed back by the client in the X-CSRF-Token header (or _csrf in
// the body). Because the token lives in the session it stays valid for the whole
// session lifetime — it does not rotate per request — so the SPA can fetch it
// once and reuse it for every mutation without ever provoking a 403 refresh loop.
// Skipped for Bearer-token API key requests (those are already cryptographically auth'd).

const {
  generateToken: generateCsrfToken,
  csrfSynchronisedProtection,
  invalidCsrfTokenError,
} = csrfSync({
  size: 32,
  getTokenFromRequest: (req) =>
    req.headers['x-csrf-token'] || (req.body && req.body._csrf),
});

// True when the request comes directly from localhost (and was not proxied
// on behalf of a remote client, per X-Real-IP / X-Forwarded-For). Used by the
// CSRF guard and the localhost-or-admin auth below to let the manager's own
// agent through without credentials during bootstrap.
function isLocalhostRequest(req) {
  const isLocalhost = (ip) =>
    ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';

  const directIp = req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip;
  const realIp = req.get('X-Real-IP');
  // First hop of X-Forwarded-For is the original client (covers proxies that
  // set it without also setting X-Real-IP).
  const forwardedFor = (req.get('X-Forwarded-For') || '').split(',')[0].trim();

  return isLocalhost(directIp)
    && (!realIp || isLocalhost(realIp))
    && (!forwardedFor || isLocalhost(forwardedFor));
}

// CSRF guard: enforce on state-changing methods. Only exempt requests that
// are purely Bearer-authenticated (i.e., do NOT also carry a session cookie).
// A session cookie is always sent by browsers, so a Bearer header alone
// cannot be used by an attacker to bypass CSRF on a cookie-authenticated
// session. Verifying the Bearer is left to apiAuth; the goal here is only
// to deny the bypass to attackers who can't actually authenticate.
function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  // The manager's own agent checks in over localhost without credentials
  // during bootstrap (no site or API key exists yet), so it can carry neither
  // a Bearer token nor a CSRF token. The check-in and accounting routes apply
  // the same localhost bypass at the route level (localhostOrAdmin); mirror it
  // here so this app-level guard doesn't reject the credential-less check-in
  // first. Remote clients are never localhost (isLocalhostRequest also rejects
  // proxied requests via X-Real-IP / X-Forwarded-For).
  if (isLocalhostRequest(req)) return next();
  const auth = req.get('Authorization') || '';
  const hasBearer = auth.startsWith('Bearer ');
  const hasSessionCookie = !!(req.session && req.session.user);
  if (hasBearer && !hasSessionCookie) return next();
  return csrfSynchronisedProtection(req, res, next);
}

// --- Auth ---------------------------------------------------------------------------------
/**
 * Resolve a Bearer credential: a manager-issued OAuth access token (see
 * resources/oauth) or an API key.
 *
 * @param {string} token
 * @param {{ expectedAudience?: string|null }} [opts] OAuth audience to enforce
 *   (the /mcp guard passes the request origin; see authenticateAccessToken).
 * @returns {Promise<{ user, apiKey?, oauthGrantId? } | { error: string, reason: string }>}
 */
async function authenticateBearer(token, opts = {}) {
  // Lazy: resources/oauth imports this module (ApiError). OAuth tokens first:
  // one indexed lookup by hash, while API keys need an argon2 check.
  const oauth = require('../resources/oauth/service');
  const result = await oauth.authenticateAccessToken(token, opts);
  if (!result.error) return { user: result.user, oauthGrantId: result.grantId };
  if (!result.unknown) return result; // ours, but expired / wrong audience / owner gone

  const { ApiKey, User } = require('../models');
  const { extractKeyPrefix } = require('../utils/apikey');
  const apiKeys = await ApiKey.findAll({
    where: { keyPrefix: extractKeyPrefix(token) },
    include: [{ model: User, as: 'user', include: [{ association: 'groups' }] }],
  });
  for (const stored of apiKeys) {
    if (await stored.validateKey(token)) {
      stored.recordUsage().catch((err) =>
        console.error('Failed to record API key usage:', err),
      );
      return { user: stored.user, apiKey: stored };
    }
  }
  return { error: 'invalid_token', reason: 'Invalid API key' };
}

function bearerToken(req) {
  const header = req.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.substring(7).trim() : '';
}

/**
 * RFC 6750 / RFC 9728 challenge. `resource_metadata` tells MCP clients where
 * to start OAuth discovery.
 */
function bearerChallenge(resourceMetadataUrl, { error, description } = {}) {
  const quote = (v) => `"${String(v).replace(/["\\]/g, '')}"`;
  const parts = [`resource_metadata=${quote(resourceMetadataUrl)}`, 'scope="manager"'];
  if (error) parts.push(`error=${quote(error)}`);
  if (description) parts.push(`error_description=${quote(description)}`);
  return `Bearer ${parts.join(', ')}`;
}

async function apiAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  const token = bearerToken(req);
  const result = token ? await authenticateBearer(token) : null;
  if (result && !result.error) {
    const { user } = result;
    req.user = user;
    if (result.apiKey) req.apiKey = result.apiKey;
    if (result.oauthGrantId) req.oauthGrantId = result.oauthGrantId;
    // Admin status always comes from current group membership, never from
    // the credential, so removing someone from sysadmins takes effect at once.
    req.isAdmin = user.groups?.some((g) => g.isAdmin) || false;
    req.session = req.session || {};
    req.session.user = user.uid;
    req.session.isAdmin = req.isAdmin;
    return next();
  }

  const { requestOrigin } = require('../utils/request-origin');
  res.set('WWW-Authenticate', bearerChallenge(
    `${requestOrigin(req)}/.well-known/oauth-protected-resource`,
    result ? { error: result.error } : {},
  ));
  return res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
}

function apiAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(403).json({ error: { code: 'forbidden', message: 'Admin access required' } });
}

// Trust model for machine-facing endpoints the site proxy/agent calls: the
// manager's own agent reaches them over localhost without credentials
// (bootstrap — no site or API key exists yet), while remote agents must
// present an admin API key (apiAuth + apiAdmin, so error responses follow the
// v1 JSON envelope). Shared by the agent check-in and the service-accounting
// routes.
function localhostOrAdmin(req, res, next) {
  if (isLocalhostRequest(req)) return next();
  return apiAuth(req, res, (err) => {
    if (err) return next(err);
    return apiAdmin(req, res, next);
  });
}

// --- Helpers ------------------------------------------------------------------------------
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function ok(res, data, meta) {
  return res.json(meta ? { data, meta } : { data });
}

function created(res, data) {
  return res.status(201).json({ data });
}

function noContent(res) {
  return res.status(204).end();
}

function fail(res, status, code, message, fields) {
  return res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}

// Final JSON error handler — mount at the end of the /api/v1 stack.
function jsonErrorHandler(err, req, res, _next) {
  if (err && err === invalidCsrfTokenError) {
    return fail(res, 403, 'csrf_invalid', 'Invalid CSRF token');
  }
  if (err && err.name === 'SequelizeValidationError') {
    const fields = {};
    for (const ve of err.errors || []) {
      if (ve.path) fields[ve.path] = ve.message;
    }
    return fail(res, 422, 'validation_failed', 'Validation failed', fields);
  }
  if (err && err.name === 'SequelizeUniqueConstraintError') {
    const fields = {};
    for (const ve of err.errors || []) {
      if (ve.path) fields[ve.path] = `${ve.path} already exists`;
    }
    return fail(res, 409, 'conflict', 'Resource already exists', fields);
  }
  // Plain Error with .status — let route handlers throw with shape { status, code, message, fields? }
  if (err && err.status && Number.isInteger(err.status)) {
    return fail(res, err.status, err.code || 'error', err.message || 'Request failed', err.fields);
  }
  console.error('[api/v1] Unhandled error:', err);
  return fail(res, 500, 'internal_error', 'Internal server error');
}

class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

module.exports = {
  apiAuth,
  authenticateBearer,
  bearerToken,
  bearerChallenge,
  apiAdmin,
  localhostOrAdmin,
  isLocalhostRequest,
  csrfGuard,
  generateCsrfToken,
  asyncHandler,
  ok,
  created,
  noContent,
  fail,
  jsonErrorHandler,
  ApiError,
};
