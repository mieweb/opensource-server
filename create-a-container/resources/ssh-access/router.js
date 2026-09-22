/**
 * /api/v1/containers/:id/ssh-access — the ssh-access resource. One canonical
 * path; a container is identified by its (globally unique) id.
 *
 *   GET  /:username → 204 owner/collaborator, 403 otherwise
 *        Consulted by sshd inside the container; container-token (Bearer) auth
 *        (the caller is the container, not a user session).
 *
 *   POST /token → 201 { containerId, token } (plaintext once)
 *        Owner/admin mints (or rotates) that token; session auth. Used by the
 *        part-2 enrollment script and the manage UI.
 *
 * Both routes are the same resource and share this resource's service; they
 * differ only in auth, so each carries its own auth middleware (as
 * notifications/router.js does). Answers are computed live from the DB, so
 * share/unshare takes effect on the next SSH connection.
 */

const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { idParam, usernameParam } = require('./validator');
const { containerTokenAuth } = require('./auth');
const ctrl = require('./controller');

// mergeParams so :id from the parent mount (/containers/:id/ssh-access) is here.
const router = express.Router({ mergeParams: true });

// Owner/admin token mint (session auth). Registered before "/:username" so the
// literal "token" segment isn't captured as a username by the GET route (they
// differ by method too, but keep the ordering explicit).
router.post('/token', apiAuth, validate({ params: idParam }), ctrl.mint);

// Container-facing check (container-token auth).
router.get(
  '/:username',
  validate({ params: idParam.merge(usernameParam) }),
  containerTokenAuth,
  ctrl.check,
);

module.exports = router;
