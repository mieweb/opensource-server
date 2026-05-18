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
  ok,
} = require('../../../middlewares/api');

const router = express.Router();

// OpenAPI spec (loaded once at import time)
const openapiSpec = YAML.load(path.join(__dirname, '..', '..', '..', 'openapi.v1.yaml'));

router.use(cookieParser());
router.use(express.json({ limit: '1mb' }));
router.use(express.urlencoded({ extended: true }));

// Public token endpoint — clients call this before any state-changing request.
router.get('/csrf-token', (req, res) => {
  const csrfToken = generateCsrfToken(req, res);
  return ok(res, { csrfToken });
});

// Health check (unauthenticated)
router.get('/health', (_req, res) => ok(res, { status: 'ok' }));

// OpenAPI v1 spec (unauthenticated)
router.get('/openapi.json', (_req, res) => res.json(openapiSpec));
router.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').sendFile(path.join(__dirname, '..', '..', '..', 'openapi.v1.yaml'));
});

// CSRF guard before any state-changing route below
router.use(csrfGuard);

// Auth routes (login/register/reset are intentionally outside apiAuth)
router.use('/auth', require('./auth'));

// Authenticated session check
router.get('/session', apiAuth, (req, res) =>
  ok(res, {
    user: req.session.user,
    isAdmin: !!req.session.isAdmin,
  }),
);

// Resource routes — each sub-router applies its own apiAuth/apiAdmin
router.use('/sites', require('./sites'));
router.use('/external-domains', require('./external-domains'));
router.use('/groups', require('./groups'));
router.use('/users', require('./users'));
router.use('/apikeys', require('./apikeys'));
router.use('/settings', require('./settings'));
router.use('/jobs', require('./jobs'));

// Final error handler — must come after all routes
router.use(jsonErrorHandler);

module.exports = router;
