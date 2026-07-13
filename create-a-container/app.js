/**
 * Express app construction, separated from process startup (server.js) so
 * tests can exercise the real app via supertest without binding a port or
 * bootstrapping DB-backed session secrets.
 *
 * Everything HTTP-visible belongs here; server.js only fetches secrets and
 * calls listen().
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const morgan = require('morgan');
const fs = require('fs');
const SequelizeStore = require('express-session-sequelize')(session.Store);
const path = require('path');
const RateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const { sequelize } = require('./models');

/**
 * @param {object} options
 * @param {string|string[]} options.sessionSecrets - express-session secret(s); required.
 * @param {boolean} [options.rateLimit=true]  - disable in tests: assertions on 4xx
 *                                              responses must not burn the budget.
 * @param {boolean} [options.accessLog=true]  - morgan; disable in tests for quiet output.
 */
function buildApp({ sessionSecrets, rateLimit = true, accessLog = true } = {}) {
  if (!sessionSecrets || sessionSecrets.length === 0) {
    throw new Error('buildApp: sessionSecrets is required');
  }

  const app = express();

  // setup views (still used by templates router for nginx-conf / dnsmasq files)
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.set('trust proxy', 1);
  // Parse query strings with qs so bracket notation (e.g. `user[0]=alice`)
  // yields real arrays. Express 5 defaults to the 'simple' parser.
  app.set('query parser', 'extended');

  // setup middleware
  if (accessLog) {
    const accessLogStream = process.env.ACCESS_LOG
      ? fs.createWriteStream(process.env.ACCESS_LOG, { flags: 'a' })
      : process.stdout;
    app.use(morgan('combined', { stream: accessLogStream }));
  }
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Configure session store
  const sessionStore = new SequelizeStore({
    db: sequelize,
  });
  // The store's expired-session sweeper (setInterval, no stop API) must not
  // keep the process alive on its own: in production the listening socket
  // does that, and test runners need the event loop to drain to exit.
  if (sessionStore._expirationInterval?.unref) {
    sessionStore._expirationInterval.unref();
  }

  app.use(session({
    secret: sessionSecrets,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    // `secure` is derived from the request protocol (honoring `trust proxy`
    // and X-Forwarded-Proto from nginx) rather than NODE_ENV, so the flag
    // tracks the actual transport — set on HTTPS, omitted on plain HTTP
    // bootstrap/dev access.
    cookie: function(req) {
      return {
        secure: req.secure,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax',
      };
    }
  }));

  app.use(express.static('public'));

  // We rate limit unsuccessful (4xx/5xx statuses, excluding 404) to only 10 per 5 minutes, this
  // should allow legitimate users a few tries to login or experiment without
  // allowing bad-actors to abuse requests. 404s are excluded because browsers
  // (especially Safari) automatically request favicon/apple-touch-icon paths that
  // don't exist, and those harmless misses should not burn the rate-limit budget.
  if (rateLimit) {
    app.use(RateLimit({
      windowMs: 5 * 60 * 1000,
      max: 10,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (req, res) => res.statusCode < 400 || res.statusCode === 404,
    }));
  }

  // Set version info once at startup in app.locals
  // Note: Version info is cached at startup. Server restart required to update version.
  const { getVersionInfo } = require('./utils');
  app.locals.versionInfo = getVersionInfo();

  // --- Mount Routers ---
  const apiV1Router = require('./routers/api/v1');
  const templatesRouter = require('./routers/templates');

  app.use('/api/v1', apiV1Router);
  app.use('/', templatesRouter); // serves /sites/:siteId/nginx and /sites/:siteId/dnsmasq/:file

  // --- API Documentation (Swagger UI) ---
  // Swagger UI at /api documents the versioned v1 API (the spec also served at /api/v1/openapi.*).
  const openapiSpec = YAML.load(path.join(__dirname, 'openapi.v1.yaml'));
  app.get('/api/openapi.json', (req, res) => res.json(openapiSpec));
  app.get('/api/openapi.yaml', (req, res) => {
    res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.v1.yaml'));
  });
  app.use('/api', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'Create-a-Container API',
  }));

  // --- SPA: serve compiled React app for everything else ---
  const clientDist = path.join(__dirname, 'client', 'dist');
  app.use(express.static(clientDist));
  app.get(/^\/(?!api(\/|$)|sites\/[^/]+\/(nginx$|dnsmasq\/)).*$/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}

module.exports = { buildApp };
