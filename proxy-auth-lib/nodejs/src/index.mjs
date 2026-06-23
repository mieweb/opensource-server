import { createPublicKey, createVerify } from 'node:crypto';

const UNAUTHORIZED_BODY = JSON.stringify({ error: 'invalid_assertion' });

export function loadConfigFromEnv(env = process.env) {
  return {
    header: env.TRUSTED_PROXY_ASSERTION_HEADER,
    jwksUrl: env.TRUSTED_PROXY_JWKS_URL,
    issuer: env.TRUSTED_PROXY_ISSUER,
    audience: env.TRUSTED_PROXY_AUDIENCE,
  };
}

export function createTrustedProxyAuth(config, options = {}) {
  validateConfig(config);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required to resolve JWKS');
  }

  return async function trustedProxyAuth(req, res, next) {
    try {
      const token = readHeader(req, config.header);
      if (!token) {
        throw new Error('missing assertion');
      }

      req.trustedProxyIdentity = await verifyAssertion(token, config, fetchImpl);
      next();
    } catch {
      if (typeof res.status === 'function') {
        res.status(401);
      } else {
        res.statusCode = 401;
      }

      if (typeof res.json === 'function') {
        res.json({ error: 'invalid_assertion' });
        return;
      }

      if (typeof res.setHeader === 'function') {
        res.setHeader('content-type', 'application/json');
      }
      res.end(UNAUTHORIZED_BODY);
    }
  };
}

export async function verifyAssertion(token, config, fetchImpl = globalThis.fetch) {
  validateConfig(config);
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required to resolve JWKS');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('malformed assertion');
  }

  const header = parseSegment(parts[0]);
  const claims = parseSegment(parts[1]);
  const signature = decodeBase64Url(parts[2]);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('unsupported assertion');
  }

  const jwks = await fetchJwks(config.jwksUrl, fetchImpl);
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    throw new Error('unknown signing key');
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (!verifier.verify(key, signature)) {
    throw new Error('invalid signature');
  }

  if (claims.iss !== config.issuer) {
    throw new Error('wrong issuer');
  }

  if (!matchesAudience(claims.aud, config.audience)) {
    throw new Error('wrong audience');
  }

  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('expired assertion');
  }

  return {
    subject: claims.sub,
    email: claims.email ?? null,
    name: claims.name ?? null,
    claims,
  };
}

async function fetchJwks(jwksUrl, fetchImpl) {
  const response = await fetchImpl(jwksUrl);
  if (!response.ok) {
    throw new Error('failed to load jwks');
  }
  return response.json();
}

function matchesAudience(actual, expected) {
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  return actual === expected;
}

function readHeader(req, headerName) {
  const key = headerName.toLowerCase();
  const fromHeaders = req.headers?.[key] ?? req.headers?.[headerName] ?? req.get?.(headerName);
  const value = Array.isArray(fromHeaders) ? fromHeaders[0] : fromHeaders;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateConfig(config) {
  for (const key of ['header', 'jwksUrl', 'issuer', 'audience']) {
    if (!config?.[key]) {
      throw new Error(`missing config: ${key}`);
    }
  }
}

function parseSegment(segment) {
  return JSON.parse(decodeBase64Url(segment).toString('utf8'));
}

function decodeBase64Url(segment) {
  return Buffer.from(segment, 'base64url');
}
