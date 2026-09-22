/**
 * /api/v1/containers/:id/ssh-access — consulted by sshd inside a container.
 *
 * GET /:username → 204 owner or collaborator, 403 otherwise.
 *
 * The caller is the container itself, authenticating with its own token
 * (CONTAINER_SSH_TOKEN, hashed on the Container record) rather than a user
 * session — so this resource is mounted outside the /sites tree and applies
 * its own container-token auth. Answers are computed live from the DB, so
 * share/unshare takes effect on the next SSH connection.
 *
 * Minting/rotating that token (POST /sites/:siteId/containers/:id/ssh-access/
 * token) is owner/admin-scoped and lives with the containers resource.
 */

const express = require('express');
const { validate } = require('../../middlewares/validate');
const { idParam, usernameParam } = require('./validator');
const { containerTokenAuth } = require('./auth');
const ctrl = require('./controller');

// mergeParams so :id from the parent mount (/containers/:id/ssh-access) is here.
const router = express.Router({ mergeParams: true });

router.get(
  '/:username',
  validate({ params: idParam.merge(usernameParam) }),
  containerTokenAuth,
  ctrl.check,
);

module.exports = router;
