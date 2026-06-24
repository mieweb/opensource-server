// Convenience barrel. For lighter imports use the per-framework subpaths:
//   @mieweb/trusted-proxy-auth/express
//   @mieweb/trusted-proxy-auth/fastify
//   @mieweb/trusted-proxy-auth/hono
// Meteor apps use the Atmosphere package `mieweb:accounts-proxy-auth`, which
// depends on this package for verification.
export { loadConfigFromEnv, verifyAssertion } from './core.mjs';
export { createTrustedProxyAuth } from './express.mjs';
export { fastifyTrustedProxyAuth } from './fastify.mjs';
export { honoTrustedProxyAuth } from './hono.mjs';
