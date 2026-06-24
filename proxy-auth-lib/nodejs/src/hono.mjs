import { UNAUTHORIZED_RESPONSE, headerValue, resolveFetch, validateConfig, verifyAssertion } from './core.mjs';

// Hono middleware: `app.use('*', honoTrustedProxyAuth(config))`. On success the
// verified identity is available via `c.get('trustedProxyIdentity')`.
export function honoTrustedProxyAuth(config, options = {}) {
  validateConfig(config);
  const fetchImpl = resolveFetch(options);

  return async function trustedProxyAuthMiddleware(c, next) {
    const token = headerValue(c.req.header(config.header));
    if (!token) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }

    try {
      c.set('trustedProxyIdentity', await verifyAssertion(token, config, fetchImpl));
    } catch {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }

    await next();
  };
}
