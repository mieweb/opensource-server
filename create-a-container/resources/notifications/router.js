/**
 * /api/v1/notifications — node-side event queue.
 *
 * POST /            inbound webhook (admin API key): persist a structured event.
 * GET  /            owner-scoped list for the current user's bell dropdown.
 * POST /all/ack     acknowledge all of the caller's notifications.
 * POST /:id/ack     acknowledge one notification the caller owns.
 *
 * Node-side tools (e.g. lxc-oomd) POST events with an admin API key; the web app
 * surfaces them per owner. See docs/notification-webhook.md for the contract.
 */

const express = require('express');
const { apiAuth, apiAdmin } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { createNotification, idParam, listQuery } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();

// Ingest: admin API key only. A remote node authenticates with a Bearer key;
// the Bearer-without-cookie path is exempt from csrfGuard, so this works even
// though the router is mounted after the app-level CSRF guard.
router.post('/', apiAuth, apiAdmin, validate(createNotification), ctrl.create);

// Everything below is owner-scoped and available to any authenticated caller.
router.use(apiAuth);

router.get('/', validate({ query: listQuery }), ctrl.list);
// Registered before "/:id/ack" so the literal "all" segment isn't captured as
// an id (which would fail the integer coercion in idParam).
router.post('/all/ack', ctrl.acknowledgeAll);
router.post('/:id/ack', validate({ params: idParam }), ctrl.acknowledge);

module.exports = router;
