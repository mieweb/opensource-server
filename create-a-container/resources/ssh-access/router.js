/**
 * ssh-access resource routes. One router, mounted at two prefixes because the
 * two callers live in different parts of the tree and authenticate differently:
 *
 *   GET  /api/v1/containers/:id/ssh-access/:username
 *        — consulted by sshd inside the container; container-token (Bearer)
 *          auth. Mounted outside /sites (the caller is the container, not a
 *          user session). 204 owner/collaborator, 403 otherwise.
 *
 *   POST /api/v1/sites/:siteId/containers/:id/ssh-access/token
 *        — owner/admin mints (or rotates) that token; session auth. Mounted in
 *          the /sites tree. 201 { containerId, token } (plaintext once).
 *
 * Both are the same resource and share this resource's service; only the mount
 * prefix and auth differ, so each route carries its own auth + validation
 * middleware (as notifications/router.js does). Answers are computed live from
 * the DB, so share/unshare takes effect on the next SSH connection.
 */

const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { idParam, usernameParam, siteContainerParams } = require('./validator');
const { containerTokenAuth } = require('./auth');
const ctrl = require('./controller');

// mergeParams so the ids supplied by each parent mount (:id, and :siteId for
// the /sites mount) are visible to the routes below.
const router = express.Router({ mergeParams: true });

// Container-facing check (container-token auth).
router.get(
  '/:username',
  validate({ params: idParam.merge(usernameParam) }),
  containerTokenAuth,
  ctrl.check,
);

// Owner/admin token mint (session auth). Only reachable via the /sites mount,
// where :siteId is present; the GET mount never receives a POST /token.
router.post('/token', apiAuth, validate({ params: siteContainerParams }), ctrl.mint);

module.exports = router;
