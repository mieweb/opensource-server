/**
 * /api/v1/services — machine-facing service accounting.
 *
 * POST /:id/last-access  proxy accounting: the site's nginx reports the
 *                        first access to a service after 10+ minutes of
 *                        none; sets lastAccessedAt to the current server
 *                        time (agent clocks are never trusted).
 */

const express = require('express');
const { isLocalhostRequest } = require('../../middlewares');
const { apiAuth, apiAdmin } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { idParam } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();

// Same trust model as the agent check-in (routers/api/v1/agents.js):
// the manager's own proxy reports over localhost without credentials
// (bootstrap: no API key exists yet); remote proxies authenticate with an
// admin API key.
function accountingAuth(req, res, next) {
  if (isLocalhostRequest(req)) return next();
  return apiAuth(req, res, (err) => {
    if (err) return next(err);
    return apiAdmin(req, res, next);
  });
}

router.post('/:id/last-access', accountingAuth, validate({ params: idParam }), ctrl.recordAccess);

module.exports = router;
