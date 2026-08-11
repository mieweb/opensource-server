const svc = require('./service');
const { serializeNotification } = require('./serializer');
const { asyncHandler, ok, created } = require('../../middlewares/api');

// Inbound webhook. Auth is admin-API-key (enforced in the router). Persists the
// event and echoes it back so callers can log the assigned id.
const create = asyncHandler(async (req, res) => {
  const notification = await svc.ingest(req.validated.body);
  return created(res, serializeNotification(notification));
});

// Owner-scoped list for the current user's bell.
const list = asyncHandler(async (req, res) => {
  const notifications = await svc.listForOwner(req.session.user, req.validated.query.limit);
  return ok(res, notifications.map(serializeNotification));
});

const acknowledge = asyncHandler(async (req, res) => {
  const notification = await svc.acknowledge(req.session.user, req.validated.params.id);
  return ok(res, serializeNotification(notification));
});

const acknowledgeAll = asyncHandler(async (req, res) => {
  const result = await svc.acknowledgeAll(req.session.user);
  return ok(res, result);
});

module.exports = { create, list, acknowledge, acknowledgeAll };
