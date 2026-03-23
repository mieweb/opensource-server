const fp = require('fastify-plugin');

/**
 * Method override plugin for Fastify 5.
 * Reads _method from POST form bodies and dispatches to the matching
 * PUT / DELETE / PATCH handler — replicating Express's method-override.
 */
async function methodOverride(fastify) {
  const allowedMethods = new Set(['PUT', 'DELETE', 'PATCH']);
  // { PUT: [ { match, handler, hooks, config }, ... ], DELETE: [...] }
  const routesByMethod = {};

  function handleRedirect(req, reply, done) {
    const override = req.body?._method?.toUpperCase();
    if (req.raw.method !== 'POST' || !override || !allowedMethods.has(override)) {
      return done();
    }

    const routes = routesByMethod[override];
    if (!routes) return done();

    const url = req.raw.url.split('?')[0];
    const matched = routes.find(r => r.match(url));
    if (!matched) return done();

    const { params } = matched.match(url);
    delete req.body._method;
    req.params = { ...req.params, ...params };
    req.raw.method = override;

    // Run the target route's preValidation + preHandler hooks, then its handler
    const hooks = matched.hooks.slice();
    function runNext(i) {
      if (reply.sent) return;
      if (i >= hooks.length) {
        return matched.handler(req, reply)
          .then(result => { if (result !== undefined && !reply.sent) reply.send(result); })
          .catch(err => done(err));
      }
      const hook = hooks[i];
      try {
        const result = hook(req, reply, (err) => {
          if (err) return done(err);
          runNext(i + 1);
        });
        // If hook returns a promise (async hook), handle it
        if (result && typeof result.then === 'function') {
          result.then(() => { if (!reply.sent) runNext(i + 1); }).catch(err => done(err));
        }
      } catch (err) {
        done(err);
      }
    }
    runNext(0);
  }

  fastify.addHook('onRoute', (routeOptions) => {
    const method = routeOptions.method?.toUpperCase?.() || routeOptions.method;
    if (allowedMethods.has(method)) {
      if (!routesByMethod[method]) routesByMethod[method] = [];

      // Build a simple path matcher from Fastify's URL pattern
      const matcher = buildMatcher(routeOptions.url);
      const hooks = [
        ...normalizeHooks(routeOptions.preValidation),
        ...normalizeHooks(routeOptions.preHandler),
      ];

      routesByMethod[method].push({
        match: matcher,
        handler: routeOptions.handler,
        hooks,
        config: routeOptions.config,
      });
    }

    // Inject our redirect hook into every POST route's preHandler chain
    if (method === 'POST') {
      const existing = normalizeHooks(routeOptions.preHandler);
      routeOptions.preHandler = [handleRedirect, ...existing];
    }
  });

  // Handle POST requests to URLs that have no POST route but do have
  // PUT/DELETE routes (e.g., POST /sites/1 with _method=DELETE).
  fastify.setNotFoundHandler({
    preHandler: handleRedirect,
  }, async (request, reply) => {
    return reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });
}

function normalizeHooks(hooks) {
  if (!hooks) return [];
  return Array.isArray(hooks) ? hooks : [hooks];
}

/**
 * Build a simple URL path matcher from a Fastify route pattern.
 * Supports :param and * wildcard segments.
 * Returns a function: (url) => false | { params }
 */
function buildMatcher(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map(seg => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      if (seg === '*') {
        paramNames.push('*');
        return '(.+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  const regex = new RegExp(`^${regexStr}$`);

  return function match(url) {
    const m = regex.exec(url);
    if (!m) return false;
    const params = {};
    paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
    return { params };
  };
}

module.exports = fp(methodOverride, {
  name: 'method-override',
  dependencies: ['@fastify/formbody'],
});
