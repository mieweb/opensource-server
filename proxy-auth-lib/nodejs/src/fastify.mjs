import { UNAUTHORIZED_RESPONSE, headerValue, resolveFetch, validateConfig, verifyAssertion } from './core.mjs';

// Fastify preHandler hook. Register with `fastify.addHook('preHandler', hook)`
// or per-route via `{ preHandler: hook }`. On success the verified identity is
// attached as `request.trustedProxyIdentity`.
export function fastifyTrustedProxyAuth(config, options = {}) {
  validateConfig(config);
  const fetchImpl = resolveFetch(options);

  return async function trustedProxyAuthHook(request, reply) {
    const token = headerValue(request.headers?.[config.header.toLowerCase()] ?? request.headers?.[config.header]);
    if (!token) {
      return reply.code(401).type('application/json').send(UNAUTHORIZED_RESPONSE);
    }

    try {
      request.trustedProxyIdentity = await verifyAssertion(token, config, fetchImpl);
    } catch {
      return reply.code(401).type('application/json').send(UNAUTHORIZED_RESPONSE);
    }
  };
}
