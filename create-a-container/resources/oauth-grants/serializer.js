/** Where a client sends users back to: scheme + host of each redirect URI, deduplicated. */
function redirectHosts(uris = []) {
  const hosts = new Set();
  for (const uri of uris) {
    try {
      const u = new URL(uri);
      hosts.add(`${u.protocol}//${u.host}`);
    } catch {
      /* stored URIs were validated at registration; skip anything odd */
    }
  }
  return [...hosts];
}

/** An OAuthPayloads Grant row; client display info is in `meta` (see resources/oauth/service/consent.js). */
function serializeOAuthGrant(g) {
  const meta = g.meta || {};
  return {
    id: g.id,
    clientId: g.clientId,
    clientName: meta.clientName || g.clientId,
    registrationType: meta.registrationType || 'dynamic',
    redirectHosts: redirectHosts(meta.redirectUris),
    scope: g.payload?.openid?.scope || 'manager',
    user: g.accountId,
    lastUsedAt: g.lastUsedAt,
    createdAt: g.createdAt,
  };
}

module.exports = { serializeOAuthGrant, redirectHosts };
