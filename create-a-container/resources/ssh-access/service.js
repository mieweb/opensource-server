const repo = require('./repository');
const { ApiError } = require('../../middlewares/api');

/**
 * Authenticate a container by the bearer token it presents (CONTAINER_SSH_TOKEN,
 * verified against the stored argon2 hash). Returns the container (with its
 * collaborators loaded) or throws 401 — the caller authenticates *as* the
 * container, so an unknown id, an unenrolled container (no hash), and a wrong
 * token are all indistinguishable "invalid token" cases by design.
 * @param {number} id - container id from the URL (already validated)
 * @param {string} token - bearer token from the Authorization header
 * @returns {Promise<import('sequelize').Model>}
 */
async function authenticateContainer(id, token) {
  if (!token) throw new ApiError(401, 'unauthorized', 'Container token required');
  const container = await repo.findWithCollaborators(id);
  if (!container || !(await container.verifySshAccessToken(token))) {
    throw new ApiError(401, 'unauthorized', 'Invalid container token');
  }
  return container;
}

/**
 * Whether `username` may SSH into `container` (owner or collaborator). Throws
 * 403 otherwise, logging the denial. Returns nothing on allow — the controller
 * maps that to 204.
 * @param {import('sequelize').Model} container - authenticated container
 * @param {string} username - login name (already validated)
 */
function assertUserAllowed(container, username) {
  if (container.sshAllowsUser(username)) return;
  console.warn(
    `[ssh-access] denied ${username} on container ${container.id} (${container.hostname})`,
  );
  throw new ApiError(403, 'forbidden', 'User is not the owner or a collaborator of this container');
}

module.exports = { authenticateContainer, assertUserAllowed };
