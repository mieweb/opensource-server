/**
 * Mail account credential helpers (issue #67).
 *
 * Passwords are 256-bit random, shown to the user exactly once, and stored
 * as Argon2id PHC strings. parallelism MUST stay 1: Dovecot verifies
 * {ARGON2ID} hashes via libsodium, which only supports p=1.
 */

const crypto = require('crypto');
const argon2 = require('argon2');

// Admin-only local parts (RFC 2142 role addresses + operational names).
const RESERVED_LOCAL_PARTS = [
  'postmaster', 'abuse', 'hostmaster', 'webmaster', 'root',
  'admin', 'security', 'noreply', 'dmarc',
];

const DEFAULT_QUOTA_MB = 1024;

/** @returns {string} 43-char base64url string (32 random bytes). */
function generateMailPassword() {
  return crypto.randomBytes(32).toString('base64url');
}

/** @param {string} password @returns {Promise<string>} Argon2id PHC string with p=1. */
async function hashMailPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id, parallelism: 1 });
}

/** @param {string} localPart */
function isReservedLocalPart(localPart) {
  return RESERVED_LOCAL_PARTS.includes(String(localPart).toLowerCase());
}

module.exports = {
  RESERVED_LOCAL_PARTS,
  DEFAULT_QUOTA_MB,
  generateMailPassword,
  hashMailPassword,
  isReservedLocalPart,
};
