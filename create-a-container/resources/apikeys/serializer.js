/** ApiKey row -> API JSON. Never exposes keyHash or the plaintext key. */
function serializeApiKey(k) {
  return {
    id: k.id,
    keyPrefix: k.keyPrefix,
    description: k.description,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

module.exports = { serializeApiKey };
