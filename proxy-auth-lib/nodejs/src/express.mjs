import { headerValue, resolveFetch, sendUnauthorized, validateConfig, verifyAssertion } from './core.mjs';

// Express / connect-style middleware: (req, res, next).
export function createTrustedProxyAuth(config, options = {}) {
  validateConfig(config);
  const fetchImpl = resolveFetch(options);

  return async function trustedProxyAuth(req, res, next) {
    try {
      const raw =
        req.headers?.[config.header.toLowerCase()] ?? req.headers?.[config.header] ?? req.get?.(config.header);
      const token = headerValue(raw);
      if (!token) {
        throw new Error('missing assertion');
      }

      req.trustedProxyIdentity = await verifyAssertion(token, config, fetchImpl);
      next();
    } catch {
      sendUnauthorized(res);
    }
  };
}
