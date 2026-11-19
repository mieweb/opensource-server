/**
 * Hashing for OAuth secrets at rest (tokens, codes, client secrets).
 *
 * SHA-256, not argon2 like ApiKey: these secrets are 256-bit random values,
 * so a slow password hash adds no brute-force resistance and would cost
 * tens of milliseconds on every /mcp and /api/v1 request.
 */

const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

const SECRET_PREFIX = 'sha256:';

/** Stored form of a client secret. */
function hashSecret(secret) {
  return SECRET_PREFIX + sha256(secret);
}

function isHashedSecret(value) {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX) && value.length === SECRET_PREFIX.length + 64;
}

module.exports = { sha256, safeEqualHex, hashSecret, isHashedSecret };
