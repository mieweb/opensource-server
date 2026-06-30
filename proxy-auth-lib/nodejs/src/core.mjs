import { createPublicKey, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';

export const UNAUTHORIZED_RESPONSE = { error: 'invalid_assertion' };
export const UNAUTHORIZED_BODY = JSON.stringify(UNAUTHORIZED_RESPONSE);

// Reasonable defaults so every setting is optional. The auth domain is derived
// from the host's FQDN (`web1.os.example.org` -> `auth.os.example.org`); issuer
// and JWKS come from it. Override any single value with its own env var.
export const DEFAULT_ASSERTION_HEADER = 'X-Trusted-Proxy-Assertion';

export function deriveAuthDomain(hostname = os.hostname()) {
  const labels = String(hostname).split('.').filter(Boolean);
  const parent = labels.length > 1 ? labels.slice(1).join('.') : labels[0] || 'localhost';
  return `auth.${parent}`;
}

export function loadConfigFromEnv(env = process.env, hostname = os.hostname()) {
  const domain = env.TRUSTED_PROXY_AUTH_DOMAIN || deriveAuthDomain(hostname);
  const base = `https://${domain}`;
  return {
    header: env.TRUSTED_PROXY_ASSERTION_HEADER || DEFAULT_ASSERTION_HEADER,
    jwksUrl: env.TRUSTED_PROXY_JWKS_URL || `${base}/.well-known/jwks.json`,
    issuer: env.TRUSTED_PROXY_ISSUER || base,
    audience: env.TRUSTED_PROXY_AUDIENCE || base,
    publicKey: resolvePublicKey(env),
  };
}

// JWKS is preferred for key rotation. A static public key (PEM) is an opt-in
// alternative for self-signed assertions: when set, verification uses it
// directly and never touches the network.
function resolvePublicKey(env) {
  if (env.TRUSTED_PROXY_PUBLIC_KEY) {
    return env.TRUSTED_PROXY_PUBLIC_KEY;
  }
  if (env.TRUSTED_PROXY_PUBLIC_KEY_FILE) {
    return readFileSync(env.TRUSTED_PROXY_PUBLIC_KEY_FILE, 'utf8');
  }
  return null;
}

export function resolveFetch(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required to resolve JWKS');
  }
  return fetchImpl;
}

export function headerValue(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function sendUnauthorized(res) {
  if (typeof res.status === 'function') {
    res.status(401);
  } else {
    res.statusCode = 401;
  }

  if (typeof res.json === 'function') {
    res.json(UNAUTHORIZED_RESPONSE);
    return;
  }

  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'application/json');
  }
  res.end(UNAUTHORIZED_BODY);
}

export async function verifyAssertion(token, config, fetchImpl = globalThis.fetch) {
  validateConfig(config);

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('malformed assertion');
  }

  const header = parseSegment(parts[0]);
  const claims = parseSegment(parts[1]);
  const signature = decodeBase64Url(parts[2]);

  // Pin the algorithm: never let the token pick a weaker scheme.
  if (header.alg !== 'RS256') {
    throw new Error('unsupported assertion');
  }

  const key = await resolveVerificationKey(header, config, fetchImpl);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
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

async function resolveVerificationKey(header, config, fetchImpl) {
  if (config.publicKey) {
    return createPublicKey(config.publicKey);
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required to resolve JWKS');
  }
  if (!header.kid) {
    throw new Error('unsupported assertion');
  }
  const jwks = await fetchJwks(config.jwksUrl, fetchImpl);
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    throw new Error('unknown signing key');
  }
  return createPublicKey({ key: jwk, format: 'jwk' });
}

export function validateConfig(config) {
  for (const key of ['header', 'issuer', 'audience']) {
    if (!config?.[key]) {
      throw new Error(`missing config: ${key}`);
    }
  }
  if (!config.publicKey && !config.jwksUrl) {
    throw new Error('missing config: jwksUrl or publicKey');
  }
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

function parseSegment(segment) {
  return JSON.parse(decodeBase64Url(segment).toString('utf8'));
}

function decodeBase64Url(segment) {
  return Buffer.from(segment, 'base64url');
}
