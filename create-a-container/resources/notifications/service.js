const repo = require('./repository');
const { ApiError } = require('../../middlewares/api');

// Persist an inbound webhook event. Coerces the wire payload into the stored
// shape: ts (epoch seconds) -> eventAt (Date), and resolves the owner from
// node+ctid when the caller didn't supply one. Owner resolution is best-effort
// and never fails ingest — an event with an unresolved owner is still stored
// (it just won't surface in any user's bell until/unless owner is set).
async function ingest(payload) {
  let owner = payload.owner ?? null;
  if (!owner) {
    try {
      owner = await repo.resolveOwner(payload.node, payload.ctid);
    } catch (err) {
      // Resolution is a convenience, not a requirement. Log and move on.
      console.error('Notification owner resolution failed:', err);
      owner = null;
    }
  }

  return repo.create({
    source: payload.source,
    severity: payload.severity,
    node: payload.node ?? null,
    ctid: payload.ctid ?? null,
    owner,
    action: payload.action ?? null,
    message: payload.message,
    evidence: payload.evidence ?? null,
    eventAt:
      payload.ts === null || payload.ts === undefined ? null : new Date(payload.ts * 1000),
  });
}

async function listForOwner(owner, limit) {
  return repo.findAllForOwner(owner, limit);
}

/** Acknowledge a single notification the caller owns. Idempotent. */
async function acknowledge(owner, id) {
  const notification = await repo.findForOwner(id, owner);
  if (!notification) throw new ApiError(404, 'not_found', 'Notification not found');
  if (!notification.acknowledgedAt) {
    notification.acknowledgedAt = new Date();
    notification.acknowledgedBy = owner;
    await notification.save({ fields: ['acknowledgedAt', 'acknowledgedBy'] });
  }
  return notification;
}

/** Acknowledge all of the caller's unacknowledged notifications. */
async function acknowledgeAll(owner) {
  const count = await repo.acknowledgeAllForOwner(owner, owner, new Date());
  return { acknowledged: count };
}

module.exports = { ingest, listForOwner, acknowledge, acknowledgeAll };
