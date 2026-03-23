require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const Fastify = require('fastify');
const { sequelize, SessionSecret } = require('./models');

// Function to get or create session secrets
async function getSessionSecrets() {
  const secrets = await SessionSecret.findAll({
    order: [['createdAt', 'DESC']],
    attributes: ['secret']
  });

  if (secrets.length === 0) {
    const newSecret = crypto.randomBytes(32).toString('hex');
    await SessionSecret.create({ secret: newSecret });
    console.log('Generated new session secret');
    return [newSecret];
  }

  return secrets.map(s => s.secret);
}

async function buildApp(opts = {}) {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: { colorize: true }
      } : undefined
    },
    trustProxy: true,
    ...opts
  });

  // --- Core Plugins ---
  await app.register(require('@fastify/sensible'));
  await app.register(require('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN || false,
    credentials: true
  });
  await app.register(require('@fastify/formbody'));
  await app.register(require('./plugins/method-override'));
  await app.register(require('@fastify/cookie'));

  // --- Session ---
  const sessionSecrets = await getSessionSecrets();
  await app.register(require('@fastify/session'), {
    secret: sessionSecrets[0],
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    saveUninitialized: false
  });

  // --- Flash Messages Plugin ---
  await app.register(require('./plugins/flash'));

  // --- Static Files ---
  await app.register(require('@fastify/static'), {
    root: path.join(__dirname, 'public'),
    prefix: '/'
  });

  // --- View Engine (EJS) ---
  await app.register(require('@fastify/view'), {
    engine: { ejs: require('ejs') },
    root: path.join(__dirname, 'views'),
    viewExt: 'ejs',
    defaultContext: {
      // Global template variables
    }
  });

  // --- Rate Limiting ---
  // Express uses skipSuccessfulRequests:true (only failed responses count).
  // @fastify/rate-limit lacks this option, so we use a high max for overall
  // requests and rely on route-level guards for abuse prevention.
  await app.register(require('@fastify/rate-limit'), {
    max: 1000,
    timeWindow: 5 * 60 * 1000, // 5 minutes
    keyGenerator: (request) => request.ip
  });

  // --- Swagger/OpenAPI ---
  await app.register(require('@fastify/swagger'), {
    openapi: {
      info: {
        title: 'Create-a-Container API',
        description: `REST API for managing containers, API keys, and jobs.

## Authentication

All API endpoints require authentication via an API key passed as a Bearer token:

\`\`\`
Authorization: Bearer <your-api-key>
\`\`\`

Create API keys through \`POST /apikeys\` or the web UI at \`/apikeys/new\`.

## Content Negotiation

Routes serve both HTML and JSON. To receive JSON responses, set:

\`\`\`
Accept: application/json
\`\`\`

## Rate Limiting

Failed requests (4xx/5xx) are rate-limited to **10 per 5-minute window** per IP.`,
        version: '2.0.0',
        license: { name: 'MIT' }
      },
      servers: [{ url: '/', description: 'Current server' }],
      tags: [
        { name: 'API Keys', description: 'Manage personal API keys for Bearer token authentication' },
        { name: 'Containers', description: 'Create, list, update, and delete containers within a site' },
        { name: 'Jobs', description: 'Monitor container creation and reconfiguration jobs' },
        { name: 'Nodes', description: 'Query node storage information' },
        { name: 'Sites', description: 'Manage sites and their configuration' },
        { name: 'Users', description: 'User management' },
        { name: 'Groups', description: 'Group management' },
        { name: 'Settings', description: 'System settings' }
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'API key authentication'
          }
        }
      }
    }
  });

  await app.register(require('@fastify/swagger-ui'), {
    routePrefix: '/api',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    }
  });

  // --- Auth Plugin ---
  await app.register(require('./plugins/auth'));

  // --- Load Sites for Authenticated Users ---
  await app.register(require('./plugins/load-sites'));

  // --- Version Info ---
  const { getVersionInfo } = require('./utils');
  const versionInfo = getVersionInfo();
  app.decorate('versionInfo', versionInfo);

  // --- Global Template Context ---
  // Inject `req` and `versionInfo` into every template render via reply.locals,
  // matching Express's implicit behavior where app.locals and req are available.
  app.addHook('preHandler', async (request, reply) => {
    reply.locals = reply.locals || {};
    reply.locals.req = request;
    reply.locals.versionInfo = versionInfo;
  });

  // --- Routes ---
  app.get('/', async (request, reply) => {
    return reply.redirect('/sites');
  });

  // Register route modules
  await app.register(require('./routes/login'), { prefix: '/login' });
  await app.register(require('./routes/register'), { prefix: '/register' });
  await app.register(require('./routes/reset-password'), { prefix: '/reset-password' });
  await app.register(require('./routes/apikeys'), { prefix: '/apikeys' });
  await app.register(require('./routes/settings'), { prefix: '/settings' });
  await app.register(require('./routes/users'), { prefix: '/users' });
  await app.register(require('./routes/groups'), { prefix: '/groups' });
  await app.register(require('./routes/sites'), { prefix: '/sites' });
  await app.register(require('./routes/jobs'), { prefix: '/jobs' });
  await app.register(require('./routes/external-domains'), { prefix: '/external-domains' });

  // Logout route
  app.post('/logout', async (request, reply) => {
    request.session.destroy();
    return reply.redirect('/');
  });

  // --- MCP Server ---
  await app.register(require('./plugins/mcp'));

  return app;
}

// Start server if run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  buildApp().then(app => {
    app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      console.log('');
      console.log('='.repeat(50));
      console.log(`  Fastify server ready at ${address}`);
      console.log(`  API docs at ${address}/api`);
      console.log('='.repeat(50));
      console.log('');
    });
  });
}

module.exports = { buildApp };
