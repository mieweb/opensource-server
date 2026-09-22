/**
 * /api/v1/sites/:siteId/containers/:id/ssh-access — the owner/admin-facing
 * half of the ssh-access resource, mounted in the /sites tree (session auth)
 * because minting is authorized as a user, not as the container.
 *
 *   POST /token → 201 { containerId, token }   (owner/admin; plaintext once)
 *
 * The container-facing check endpoint (container-token auth) lives in this
 * resource's primary router.js, mounted outside /sites. Both delegate to the
 * same service.
 */

const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { siteContainerParams } = require('./validator');
const ctrl = require('./controller');

// mergeParams so :siteId and :id from the parent mount are visible here.
const router = express.Router({ mergeParams: true });

router.post('/token', apiAuth, validate({ params: siteContainerParams }), ctrl.mint);

module.exports = router;
