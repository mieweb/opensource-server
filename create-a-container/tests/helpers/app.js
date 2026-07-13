/**
 * Test app — the REAL app from app.js (same middleware stack, session store,
 * routers, and error handling as production), built with test-friendly
 * options:
 *
 *   - fixed session secret (production reads secrets from the DB in server.js)
 *   - rate limiting off (tests assert on 4xx responses; the limiter would
 *     start rejecting them after 10)
 *   - access log off (quiet output)
 *
 * Tests normally authenticate with a Bearer API key (apiAuth accepts it and
 * csrfGuard exempts Bearer-only requests), so no session/CSRF choreography
 * is needed.
 */

const { buildApp: buildRealApp } = require('../../app');

function buildApp() {
  return buildRealApp({
    sessionSecrets: ['test-secret'],
    rateLimit: false,
    accessLog: false,
  });
}

/** Convenience: supertest .set() args for Bearer-key auth. */
function bearer(plainKey) {
  return ['Authorization', `Bearer ${plainKey}`];
}

module.exports = { buildApp, bearer };
