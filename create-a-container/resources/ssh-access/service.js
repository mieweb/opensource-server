const repo = require('./repository');
const containersService = require('../containers/service');
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

/**
 * Mint (or rotate) the token sshd inside a container presents to the check
 * endpoint. Owner/admin-scoped: authorization is delegated to the containers
 * service (service-to-service, manifesto §3), which 404s a container the caller
 * can't see and 403s a collaborator who isn't the owner. The plaintext token is
 * returned exactly once — the caller (the part-2 enrollment script, or an admin)
 * pushes it into the container's env; only its argon2 hash is stored.
 * @param {number} containerId - container id (already validated positive int)
 * @param {object} session - { user, isAdmin }
 * @returns {Promise<{ containerId: number, token: string }>}
 */
async function mintToken(containerId, session) {
  const container = await containersService.loadByIdForSession(containerId, session, {
    requireManage: true,
  });
  const token = await container.rotateSshAccessToken();
  return { containerId: container.id, token };
}

module.exports = { authenticateContainer, assertUserAllowed, mintToken };
