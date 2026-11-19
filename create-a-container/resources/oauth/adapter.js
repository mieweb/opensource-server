/**
 * oidc-provider adapter over the OAuthPayloads table.
 *
 * Secrets at rest, mirroring ApiKey:
 *   - token-like records (access/refresh tokens, codes, client-credentials
 *     tokens) are keyed by SHA-256 of the token value, and the value inside
 *     the payload (`jti`) is replaced by the same hash, so the table never
 *     holds a usable token;
 *   - client secrets are replaced by `sha256:<hex>` before storage. The
 *     presented secret is hashed the same way before the provider compares
 *     it (normalizeClientAuth in controller.js).
 */

const repo = require('./repository');
const { sha256, hashSecret, isHashedSecret } = require('./service/hash');

const HASHED_ID_MODELS = new Set([
  'AccessToken', 'RefreshToken', 'AuthorizationCode', 'ClientCredentials',
]);

const toDate = (epochSec) => (epochSec ? new Date(epochSec * 1000) : null);

class SequelizeAdapter {
  constructor(model) {
    this.model = model;
  }

  key(id) {
    return HASHED_ID_MODELS.has(this.model) ? sha256(id) : id;
  }

  async upsert(id, payload, expiresIn) {
    let stored = payload;
    if (HASHED_ID_MODELS.has(this.model) && payload.jti) {
      // The payload carries the token value as `jti`; keep only its hash.
      stored = { ...payload, jti: sha256(payload.jti) };
    }
    if (this.model === 'Client' && payload.client_secret && !isHashedSecret(payload.client_secret)) {
      // Copy: the provider still sends the plaintext to the registering client.
      stored = { ...payload, client_secret: hashSecret(payload.client_secret) };
    }
    await repo.upsertRecord(this.model, this.key(id), {
      payload: stored,
      grantId: payload.grantId || null,
      uid: payload.uid || null,
      ...(payload.accountId ? { accountId: payload.accountId } : {}),
      clientId: payload.clientId || payload.client_id || null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : toDate(payload.exp),
    });
  }

  async find(id) {
    const row = await repo.findRecord(this.model, this.key(id));
    if (!row) return undefined;
    // The caller presented the token, so its value can be put back.
    return HASHED_ID_MODELS.has(this.model) ? { ...unwrap(row), jti: id } : unwrap(row);
  }

  async findByUid(uid) {
    const row = await repo.findRecordBy(this.model, 'uid', uid);
    return row ? unwrap(row) : undefined;
  }

  async findByUserCode() {
    return undefined; // device flow is disabled
  }

  async consume(id) {
    const row = await repo.findRecord(this.model, this.key(id));
    if (!row) return;
    const consumed = Math.floor(Date.now() / 1000);
    await row.update({ payload: { ...row.payload, consumed }, consumedAt: new Date() });
  }

  async destroy(id) {
    await repo.destroyRecord(this.model, this.key(id));
  }

  async revokeByGrantId(grantId) {
    await repo.destroyModelByGrantId(this.model, grantId);
  }
}

// Expiry is checked by the provider (it reads `exp` from the payload), which
// lets callers tell "expired" from "unknown"; the sweep deletes old rows.
function unwrap(row) {
  return row.payload;
}

module.exports = { SequelizeAdapter, HASHED_ID_MODELS };
