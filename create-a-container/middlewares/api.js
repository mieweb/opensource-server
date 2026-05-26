/**
 * API v1 middleware — JSON-only auth, CSRF, error handling, request helpers.
 *
 * Response shape contract:
 *   success: { data: <payload>, meta?: { ... } }
 *   error:   { error: { code: string, message: string, fields?: { [name]: string } } }
 */

const { doubleCsrf } = require('csrf-csrf');

// --- CSRF (double-submit cookie) ----------------------------------------------------------
// Token lives in a cookie + must echo in X-CSRF-Token (or _csrf in body).
// Skipped for Bearer-token API key requests (those are already cryptographically auth'd).
const isProd = process.env.NODE_ENV === 'production';

// Cached CSRF secret loaded from the SessionSecret table. The session
// secret rotates centrally (see server.js getSessionSecrets) and is shared
// across instances, so reusing it here gets us rotation + shared state
// without a separate model. CSRF_SECRET env still wins when explicitly set.
let _cachedCsrfSecret;
async function loadCsrfSecret() {
  if (process.env.CSRF_SECRET) return process.env.CSRF_SECRET;
  const { SessionSecret } = require('../models');
  const row = await SessionSecret.findOne({ order: [['createdAt', 'DESC']] });
  if (row) return row.secret;
  const crypto = require('crypto');
  const newSecret = crypto.randomBytes(32).toString('hex');
  await SessionSecret.create({ secret: newSecret });
  return newSecret;
}
async function initCsrfSecret() {
  _cachedCsrfSecret = await loadCsrfSecret();
}
const csrfSecret = () => {
  if (_cachedCsrfSecret) return _cachedCsrfSecret;
  if (isProd) {
    throw new Error('CSRF secret not initialized — call initCsrfSecret() at startup');
  }
  return 'dev-csrf-secret-change-me';
};

// __Host- prefix requires Secure + Path=/ + no Domain; browsers reject it on
// plain HTTP (including dev), so fall back to a plain cookie name off-prod.

const {
  doubleCsrfProtection,
  generateCsrfToken,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: csrfSecret,
  // Double-submit pattern is sufficient on its own; binding to req.session.id
  // breaks for anon requests because saveUninitialized:false hands out a fresh
  // session id every request until a user signs in.
  getSessionIdentifier: (req) => (req.session && req.session.user && req.session.id) || req.ip || 'anonymous',
  cookieName: isProd ? '__Host-csrf.token' : 'csrf.token',
  cookieOptions: {
    sameSite: 'lax',
    path: '/',
    secure: isProd,
    httpOnly: true,
  },
  size: 32,
  getCsrfTokenFromRequest: (req) =>
    req.headers['x-csrf-token'] || (req.body && req.body._csrf),
});

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
  const auth = req.get('Authorization') || '';
  const hasBearer = auth.startsWith('Bearer ');
  const hasSessionCookie = !!(req.session && req.session.user);
  if (hasBearer && !hasSessionCookie) return next();
  return doubleCsrfProtection(req, res, next);
}

// --- Auth ---------------------------------------------------------------------------------
async function apiAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.substring(7);
    if (apiKey) {
      const { ApiKey, User } = require('../models');
      const { extractKeyPrefix } = require('../utils/apikey');
      const keyPrefix = extractKeyPrefix(apiKey);
      const apiKeys = await ApiKey.findAll({
        where: { keyPrefix },
        include: [{ model: User, as: 'user', include: [{ association: 'groups' }] }],
      });
      for (const stored of apiKeys) {
        if (await stored.validateKey(apiKey)) {
          req.user = stored.user;
          req.apiKey = stored;
          req.isAdmin = stored.user.groups?.some((g) => g.isAdmin) || false;
          req.session = req.session || {};
          req.session.user = stored.user.uid;
          req.session.isAdmin = req.isAdmin;
          stored.recordUsage().catch((err) =>
            console.error('Failed to record API key usage:', err),
          );
          return next();
        }
      }
    }
  }

  return res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
}

function apiAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(403).json({ error: { code: 'forbidden', message: 'Admin access required' } });
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
  apiAdmin,
  csrfGuard,
  generateCsrfToken,
  initCsrfSecret,
  asyncHandler,
  ok,
  created,
  noContent,
  fail,
  jsonErrorHandler,
  ApiError,
};
