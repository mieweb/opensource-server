/**
 * Unsubscribe token minting — MUST stay byte-compatible with the manager's
 * create-a-container/utils/unsubscribe-token.js (same layout, same AAD):
 * [version:1][kidLen:1][kid][iv:12][tag:16][ciphertext], base64url, where the
 * ciphertext is AES-256-GCM over JSON {v, a: accountId, r: recipient, t: iat}.
 */

import crypto from 'crypto';

const VERSION = 1;
const IV_LEN = 12;

export interface UnsubscribeKey {
  kid: string;
  /** Base64 of 32 random bytes. */
  secret: string;
}

export function createUnsubscribeToken(
  { accountId, recipient }: { accountId: string; recipient: string },
  key: UnsubscribeKey,
): string {
  const kidBuf = Buffer.from(key.kid, 'utf8');
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key.secret, 'base64'), iv);
  cipher.setAAD(kidBuf);
  const payload = Buffer.from(JSON.stringify({
    v: VERSION,
    a: accountId,
    r: recipient.trim().toLowerCase(),
    t: Math.floor(Date.now() / 1000),
  }));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION, kidBuf.length]), kidBuf, iv, tag, ciphertext])
    .toString('base64url');
}
