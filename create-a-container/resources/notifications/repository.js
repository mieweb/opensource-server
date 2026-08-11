const { Notification, Container, sequelize } = require('../../models');
const { literal } = require('sequelize');

// Columns returned to the UI. Kept explicit so a future internal-only column
// doesn't leak through the serializer by accident.
const LIST_ATTRS = [
  'id',
  'source',
  'severity',
  'node',
  'ctid',
  'owner',
  'action',
  'message',
  'evidence',
  'eventAt',
  'acknowledgedAt',
  'acknowledgedBy',
  'createdAt',
  'updatedAt',
];

async function create(fields) {
  const created = await Notification.create(fields);
  // Reload so DB-side defaults (acknowledgedAt/acknowledgedBy = null) are
  // populated on the instance; a freshly built instance leaves them undefined,
  // which would drop those keys from the serialized JSON.
  return created.reload();
}

// Owner-scoped listing: unacknowledged first, then newest first. This ordering
// guarantees the bell's unread items sit at the top of the page, so a badge
// computed from the first `limit` rows stays accurate up to that limit.
async function findAllForOwner(owner, limit) {
  // Quote the column via the active dialect's identifier quoting rather than a
  // hardcoded "..." literal: MySQL uses backticks (and treats "..." as a string
  // literal unless ANSI_QUOTES is set), which would silently break this sort.
  const acknowledgedAtCol = sequelize
    .getQueryInterface()
    .queryGenerator.quoteIdentifier('acknowledgedAt');
  return Notification.findAll({
    where: { owner },
    attributes: LIST_ATTRS,
    order: [
      // `<col> IS NOT NULL` yields a boolean where false (unacked) < true
      // (acked) across Postgres, MySQL and SQLite, so unacked rows sort first.
      [literal(`${acknowledgedAtCol} IS NOT NULL`), 'ASC'],
      ['createdAt', 'DESC'],
    ],
    limit,
  });
}

async function findForOwner(id, owner) {
  return Notification.findOne({ where: { id, owner }, attributes: LIST_ATTRS });
}

async function acknowledgeAllForOwner(owner, by, at) {
  const [count] = await Notification.update(
    { acknowledgedAt: at, acknowledgedBy: by },
    { where: { owner, acknowledgedAt: null } }
  );
  return count;
}

// Best-effort owner resolution when the webhook payload omits `owner`. Maps a
// node name + container id back to the owning user via the Containers table.
// Returns null when it can't be resolved (unknown node/ctid, or ambiguous).
async function resolveOwner(node, ctid) {
  if (!node || !ctid) return null;
  const { Node } = require('../../models');
  const nodeRow = await Node.findOne({ where: { name: node }, attributes: ['id'] });
  if (!nodeRow) return null;
  const container = await Container.findOne({
    where: { nodeId: nodeRow.id, containerId: String(ctid) },
    attributes: ['username'],
  });
  return container ? container.username : null;
}

module.exports = {
  create,
  findAllForOwner,
  findForOwner,
  acknowledgeAllForOwner,
  resolveOwner,
};
