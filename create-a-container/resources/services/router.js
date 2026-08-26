/**
 * /api/v1/services — machine-facing service accounting.
 *
 * POST /:id/last-access  proxy accounting: the site's nginx reports the
 *                        first access to a service after 10+ minutes of
 *                        none; sets lastAccessedAt to the current server
 *                        time (agent clocks are never trusted).
 */

const express = require('express');
const { localhostOrAdmin } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { idParam } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();

// Trust model: the manager's own proxy reports over localhost without
// credentials (bootstrap); remote proxies authenticate with an admin API key.
// Shared with the agent check-in route (see middlewares/api localhostOrAdmin).
router.post('/:id/last-access', localhostOrAdmin, validate({ params: idParam }), ctrl.recordAccess);

module.exports = router;
