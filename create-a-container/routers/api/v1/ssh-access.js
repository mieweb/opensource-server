/**
 * /api/v1/containers/:id/ssh-access — consulted by sshd inside a container.
 *
 * The container authenticates with its own token (CONTAINER_SSH_TOKEN, hashed
 * on the Container record), not a user session, so this router is mounted
 * outside the /sites tree and applies its own auth.
 *
 *   GET /:username → 204 owner or collaborator, 403 otherwise
 *
 * Answers are computed live from the DB, so share/unshare takes effect on the
 * next SSH connection.
 */

const express = require('express');
const { Container } = require('../../../models');
const { asyncHandler, ApiError } = require('../../../middlewares/api');

const router = express.Router({ mergeParams: true });

// Bearer = container token. Loads the container onto req.container.
async function containerTokenAuth(req, _res, next) {
  const id = parseInt(req.params.id, 10);
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.substring(7) : '';
  if (!Number.isInteger(id) || id <= 0 || !token) {
    throw new ApiError(401, 'unauthorized', 'Container token required');
  }
  const container = await Container.findByPk(id, { include: [{ association: 'collaborators' }] });
  if (!container || !(await container.verifySshAccessToken(token))) {
    throw new ApiError(401, 'unauthorized', 'Invalid container token');
  }
  req.container = container;
  next();
}

router.use(asyncHandler(containerTokenAuth));

router.get(
  '/:username',
  asyncHandler(async (req, res) => {
    const { username } = req.params;
    if (!Container.USERNAME_RE.test(username)) {
      throw new ApiError(400, 'invalid_request', 'Invalid username');
    }
    res.set('Cache-Control', 'no-store');
    if (req.container.sshAllowsUser(username)) return res.status(204).end();
    console.warn(`[ssh-access] denied ${username} on container ${req.container.id} (${req.container.hostname})`);
    throw new ApiError(403, 'forbidden', 'User is not the owner or a collaborator of this container');
  }),
);

module.exports = router;
