const MB = 1024 * 1024;

/** Never serialized: passwordHash. BIGINT comes back as a string on Postgres. */
function serializeMailAccount(a) {
  const domain = a.domain
    ? {
      id: a.domain.id,
      name: a.domain.name,
      canSend: !!(a.domain.mailEnabled && a.domain.mailDnsVerified),
      canReceive: !!(a.domain.mailEnabled && a.domain.mailMxVerified),
    }
    : null;
  return {
    id: a.id,
    address: domain ? `${a.localPart}@${domain.name}` : null,
    localPart: a.localPart,
    domain,
    owner: a.owner ? a.owner.uid : null,
    description: a.description,
    enabled: a.enabled,
    quotaMb: Math.round(Number(a.quotaBytes) / MB),
    unsubscribeHeaders: a.unsubscribeHeaders,
    lastRotatedAt: a.lastRotatedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function serializeSuppression(s) {
  return {
    id: s.id,
    recipient: s.recipient,
    source: s.source,
    createdAt: s.createdAt,
  };
}

module.exports = { serializeMailAccount, serializeSuppression };
