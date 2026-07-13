/**
 * Minimal express app for supertest — mirrors the /api/v1 mount in server.js
 * (query parser, trust proxy, session) without listen(), morgan, rate
 * limiting, swagger, or the SPA fallback.
 *
 * Sessions use the in-memory store with a fixed secret; DB-backed session
 * secrets and the sequelize store are deployment concerns, not route
 * behavior. Tests normally authenticate with a Bearer API key (which
 * apiAuth accepts and csrfGuard exempts), so most suites never touch the
 * session at all.
 */

const express = require('express');
const session = require('express-session');

function buildApp() {
  const app = express();
  app.set('query parser', 'extended');
  app.set('trust proxy', 1);
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use('/api/v1', require('../../routers/api/v1'));
  return app;
}

/** Convenience: supertest .set() args for Bearer-key auth. */
function bearer(plainKey) {
  return ['Authorization', `Bearer ${plainKey}`];
}

module.exports = { buildApp, bearer };
