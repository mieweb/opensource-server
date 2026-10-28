/**
 * DKIM key management (issue #67). RSA-2048 per the plan; rotation is a
 * follow-up (DkimKeys.status already distinguishes active/retired).
 */

const crypto = require('crypto');

/** Date-stamped selector, e.g. "os20261008" — unique enough per domain until rotation lands. */
function defaultSelector(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `os${y}${m}${d}`;
}

/**
 * Generate an RSA-2048 DKIM key pair.
 * @returns {{selector: string, privateKey: string, publicKey: string}}
 *   privateKey: PEM (PKCS#1, what OpenDKIM reads); publicKey: base64 DER
 *   (SPKI) — the p= value of the DNS TXT record.
 */
function generateDkimKeyPair(selector = defaultSelector()) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    selector,
    privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

/** The TXT record value to publish at <selector>._domainkey.<domain>. */
function dkimDnsRecordValue(publicKey) {
  return `v=DKIM1; k=rsa; p=${publicKey}`;
}

module.exports = { defaultSelector, generateDkimKeyPair, dkimDnsRecordValue };
