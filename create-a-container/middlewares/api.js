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
const csrfSecret = () => process.env.CSRF_SECRET || process.env.SESSION_SECRET || 'dev-csrf-secret-change-me';

const {
  doubleCsrfProtection,
  generateCsrfToken,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: csrfSecret,
  getSessionIdentifier: (req) => (req.session && req.session.id) || req.ip || 'anonymous',
  cookieName: '__Host-csrf.token',
  cookieOptions: {
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  },
  size: 32,
  getCsrfTokenFromRequest: (req) =>
    req.headers['x-csrf-token'] || (req.body && req.body._csrf),
});

// CSRF guard: enforce on state-changing methods, exempt Bearer-auth requests.
function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const auth = req.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return next();
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
  asyncHandler,
  ok,
  created,
  noContent,
  fail,
  jsonErrorHandler,
  ApiError,
};
