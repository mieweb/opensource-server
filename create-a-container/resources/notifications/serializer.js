/** Notification row -> API JSON. */
function serializeNotification(n) {
  return {
    id: n.id,
    source: n.source,
    severity: n.severity,
    node: n.node,
    ctid: n.ctid,
    owner: n.owner,
    action: n.action,
    message: n.message,
    evidence: n.evidence,
    eventAt: n.eventAt,
    acknowledgedAt: n.acknowledgedAt,
    acknowledgedBy: n.acknowledgedBy,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

module.exports = { serializeNotification };
