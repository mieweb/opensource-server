/** An owned OAuthPayloads Client row (resources/oauth/service/owned-clients.js). */
function serializeOAuthClient(c) {
  return {
    id: c.id,
    clientId: c.id,
    name: c.payload.client_name,
    owner: c.accountId,
    lastUsedAt: c.lastUsedAt,
    createdAt: c.createdAt,
  };
}

module.exports = { serializeOAuthClient };
