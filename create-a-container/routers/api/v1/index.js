/**
 * /api/v1 mount point. JSON-only API for the React SPA and external consumers.
 * Co-exists with the legacy EJS routers during the React migration.
 */

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const YAML = require('yamljs');
const {
  csrfGuard,
  generateCsrfToken,
  jsonErrorHandler,
  apiAuth,
  asyncHandler,
  ok,
} = require('../../../middlewares/api');

const router = express.Router();

// OpenAPI spec (loaded once at import time)
const openapiSpec = YAML.load(path.join(__dirname, '..', '..', '..', 'openapi.v1.yaml'));

router.use(cookieParser());
router.use(express.json({ limit: '1mb' }));
router.use(express.urlencoded({ extended: true }));

// Public token endpoint — clients call this before any state-changing request.
// generateCsrfToken reuses the token already stored in the session when present
// (overwrite defaults to false), so repeated calls return a stable token that
// stays valid for the whole session.
router.get('/csrf-token', (req, res) => {
  const csrfToken = generateCsrfToken(req);
  return ok(res, { csrfToken });
});

// Health check (unauthenticated). Exposes `isDev` so the SPA can render
// non-production helpers like one-click dev login buttons, `oidcEnabled`
// so the login screen can auto-redirect to the configured identity provider,
// and `banner` — an admin-configured announcement (Settings page) shown at
// the top of the app. Supports [text](url) links, rendered by the client.
const { isOidcEnabled } = require('../../../utils/oidc');
const { Setting } = require('../../../models');
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    // The banner is cosmetic — never let a DB hiccup fail the health check.
    let banner = null;
    try {
      banner = (await Setting.get('banner_message'))?.trim() || null;
    } catch {
      /* Settings unavailable — omit the banner */
    }
    return ok(res, {
      status: 'ok',
      isDev: process.env.NODE_ENV !== 'production',
      oidcEnabled: isOidcEnabled(),
      banner,
    });
  }),
);

// OpenAPI v1 spec (unauthenticated)
router.get('/openapi.json', (_req, res) => res.json(openapiSpec));
router.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').sendFile(path.join(__dirname, '..', '..', '..', 'openapi.v1.yaml'));
});

// Agent check-in — mounted before the CSRF guard because the manager's own
// agent posts from localhost with neither a session cookie nor a Bearer token
// (auth is handled inside the router: localhost or admin API key).
router.use('/agents', require('./agents'));

// CSRF guard before any state-changing route below
router.use(csrfGuard);

// Auth routes (login/register/reset are intentionally outside apiAuth)
router.use('/auth', require('./auth'));

// Authenticated session check.
router.get('/session', apiAuth, async (req, res) => {
  return ok(res, {
    user: req.session.user,
    isAdmin: !!req.session.isAdmin,
  });
});

// Resource routes — each sub-router applies its own apiAuth/apiAdmin
router.use('/sites', require('./sites'));
router.use('/external-domains', require('./external-domains'));
router.use('/groups', require('./groups'));
router.use('/users', require('./users'));
router.use('/apikeys', require('../../../resources/apikeys/router'));
router.use('/settings', require('./settings'));
router.use('/jobs', require('./jobs'));
router.use('/resource-requests', require('./resource-requests'));

// Final error handler — must come after all routes
router.use(jsonErrorHandler);

module.exports = router;
