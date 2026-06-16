require('dotenv').config();

const express = require('express');
const session = require('express-session');
const morgan = require('morgan');
const fs = require('fs');
const SequelizeStore = require('express-session-sequelize')(session.Store);
const path = require('path');
const RateLimit = require('express-rate-limit');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const { sequelize, SessionSecret } = require('./models');


// Function to get or create session secrets
async function getSessionSecrets() {
  const secrets = await SessionSecret.findAll({
    order: [['createdAt', 'DESC']],
    attributes: ['secret']
  });

  if (secrets.length === 0) {
    // Generate a new secret if none exist
    const newSecret = crypto.randomBytes(32).toString('hex');
    await SessionSecret.create({ secret: newSecret });
    console.log('Generated new session secret');
    return [newSecret];
  }

  return secrets.map(s => s.secret);
}

async function main() {
  const app = express();

  // setup views (still used by templates router for nginx-conf / dnsmasq files)
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.set('trust proxy', 1);

  // setup middleware
  const accessLogStream = process.env.ACCESS_LOG
    ? fs.createWriteStream(process.env.ACCESS_LOG, { flags: 'a' })
    : process.stdout;
  app.use(morgan('combined', { stream: accessLogStream }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Configure session store
  const sessionStore = new SequelizeStore({
    db: sequelize,
  });

  app.use(session({
    secret: await getSessionSecrets(),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    // The manager's session cookie only needs to be valid for the manager
    // host itself — forward-auth for other subdomains is handled by an
    // external oauth2-proxy server, which manages its own cookies. We leave
    // the cookie scoped to the exact host (no `domain` attribute).
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
  app.use(RateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode < 400 || res.statusCode === 404,
  }));

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

  // --- Routes ---
  const PORT = 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

main();
