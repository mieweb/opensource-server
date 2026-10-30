/**
 * RFC 8058 one-click unsubscribe tokens (issue #67).
 *
 * AES-256-GCM over { v, accountId, recipient, iat } with the kid bound as
 * AAD. The URL reveals nothing about sender or recipient; tampering fails
 * authentication; tokens cannot be generated without the key, so knowing
 * the URL format doesn't let anyone unsubscribe other addresses.
 *
 * Layout (base64url): [version:1][kidLen:1][kid][iv:12][tag:16][ciphertext]
 *
 * Keys are STATELESS: each one is HKDF-derived from a server session secret
 * (no key table). The newest secret's derivation mints tokens; older
 * secrets' derivations keep links verifying after a rotation.
 */

const crypto = require('crypto');

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HKDF_INFO = 'opensource-mail unsubscribe v1';

/**
 * Derive the unsubscribe AES keys from the server's session secrets.
 * Deterministic — the same secrets always derive the same keys, so the
 * manager and the mail host (via the check-in snapshot) agree without
 * shared state.
 * @param {string[]} sessionSecrets - newest first (server.js order)
 * @returns {Array<{kid: string, secret: Buffer, active: boolean}>}
 */
function deriveUnsubscribeKeys(sessionSecrets) {
  return sessionSecrets.map((s, i) => {
    const secret = Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(String(s)), Buffer.alloc(0), HKDF_INFO, 32),
    );
    // kid identifies the key in the token without revealing it.
    const kid = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8);
    return { kid, secret, active: i === 0 };
  });
}

/** Session secrets loaded + derived — the key set both /u and the agent snapshot use. */
async function currentUnsubscribeKeys() {
  // Lazy require keeps this module import-safe as pure crypto for tests.
  const { SessionSecret } = require('../models');
  const secrets = await SessionSecret.findAll({
    order: [['createdAt', 'DESC']],
    attributes: ['secret'],
  });
  return deriveUnsubscribeKeys(secrets.map((s) => s.secret));
}

function secretBuffer(secret) {
  return Buffer.isBuffer(secret) ? secret : Buffer.from(secret, 'base64');
}

/**
 * @param {{accountId: string, recipient: string}} payload
 * @param {{kid: string, secret: string|Buffer}} key - the active key
 * @returns {string} base64url token
 */
function createUnsubscribeToken({ accountId, recipient }, key) {
  const kidBuf = Buffer.from(key.kid, 'utf8');
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretBuffer(key.secret), iv);
  cipher.setAAD(kidBuf);
  const payload = Buffer.from(JSON.stringify({
    v: VERSION,
    a: accountId,
    r: String(recipient).trim().toLowerCase(),
    t: Math.floor(Date.now() / 1000),
  }));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION, kidBuf.length]), kidBuf, iv, tag, ciphertext])
    .toString('base64url');
}

/**
 * @param {string} token
 * @param {Array<{kid: string, secret: string|Buffer}>} keys - verifiable keys
 * @returns {{accountId: string, recipient: string, issuedAt: number}|null}
 *   null for ANY failure — callers must answer with the same generic 400.
 */
function verifyUnsubscribeToken(token, keys) {
  const buf = Buffer.from(String(token), 'base64url');
  if (buf.length < 2 || buf[0] !== VERSION) return null;
  const kidLen = buf[1];
  const headerLen = 2 + kidLen + IV_LEN + TAG_LEN;
  if (buf.length <= headerLen) return null;
  const kid = buf.subarray(2, 2 + kidLen).toString('utf8');
  const key = keys.find((k) => k.kid === kid);
  if (!key) return null;
  const iv = buf.subarray(2 + kidLen, 2 + kidLen + IV_LEN);
  const tag = buf.subarray(2 + kidLen + IV_LEN, headerLen);
  const ciphertext = buf.subarray(headerLen);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretBuffer(key.secret), iv);
    decipher.setAAD(Buffer.from(kid, 'utf8'));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    );
    if (payload.v !== VERSION || !payload.a || !payload.r) return null;
    return { accountId: payload.a, recipient: payload.r, issuedAt: payload.t };
  } catch {
    return null;
  }
}

module.exports = {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  deriveUnsubscribeKeys,
  currentUnsubscribeKeys,
};
