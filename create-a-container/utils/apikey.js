const crypto = require('crypto');
const argon2 = require('argon2');

/**
 * Generates a secure API key with high entropy
 * @returns {string} A 44-character base64url-encoded random string
 */
function generateApiKey() {
  // Generate 32 random bytes (256 bits of entropy)
  const buffer = crypto.randomBytes(32);
  // Convert to base64url encoding (URL-safe, no padding)
  return buffer.toString('base64url');
}

/**
 * Extracts the prefix from an API key (first 8 characters)
 * @param {string} apiKey - The full API key
 * @returns {string} The first 8 characters of the API key
 */
function extractKeyPrefix(apiKey) {
  return apiKey.substring(0, 8);
}

/**
 * Hashes an API key using argon2
 * @param {string} apiKey - The plaintext API key
 * @returns {Promise<string>} The argon2 hash of the API key
 */
async function hashApiKey(apiKey) {
  return await argon2.hash(apiKey);
}

/**
 * Verifies an API key against a hash
 * @param {string} hash - The stored argon2 hash
 * @param {string} apiKey - The plaintext API key to verify
 * @returns {Promise<boolean>} True if the key matches the hash
 */
async function verifyApiKey(hash, apiKey) {
  return await argon2.verify(hash, apiKey);
}

/**
 * Generates a complete API key object ready for database insertion
 * @param {number} uidNumber - The user's UID number
 * @param {string} description - Optional description for the API key
 * @returns {Promise<{plainKey: string, keyPrefix: string, keyHash: string, uidNumber: number, description: string}>}
 */
async function createApiKeyData(uidNumber, description = null) {
  const plainKey = generateApiKey();
  const keyPrefix = extractKeyPrefix(plainKey);
  const keyHash = await hashApiKey(plainKey);
  
  return {
    plainKey, // This should only be shown once to the user
    keyPrefix,
    keyHash,
    uidNumber,
    description
  };
}

module.exports = {
  generateApiKey,
  extractKeyPrefix,
  hashApiKey,
  verifyApiKey,
  createApiKeyData
};
