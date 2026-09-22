/**
 * Minimal containers service — the public API seam other resources call before
 * the full containers migration (see docs/mvc-manifesto.md §3, §6 phase 7).
 * Cross-resource callers (e.g. ssh-access) go service-to-service through here;
 * they never touch the containers repository directly. Only single-container
 * load+authorize lives here for now.
 */

const repo = require('./repository');
const { ApiError } = require('../../middlewares/api');

/**
 * Load a container by id scoped to a site and authorize the session against it.
 * View access is enforced in the query (repository.findByIdForSession): a
 * non-admin only loads a container they own or one shared with them, so an
 * unauthorized row never comes back and this 404s without leaking existence.
 * Manage access (owner/admin — sharing, delete, token mint) is checked here and
 * returns 403: the caller can already view the container, so it leaks nothing
 * new and tells a collaborator why they can't manage it.
 * @param {*} siteId - Candidate site id (e.g. req.params.siteId).
 * @param {number} containerId - Container id (already validated positive int).
 * @param {object} session - { user, isAdmin }.
 * @param {object} [opts]
 * @param {boolean} [opts.requireManage=false] - Require owner/admin.
 * @returns {Promise<{site: object, container: object}>}
 */
async function loadForSession(siteId, containerId, session, { requireManage = false } = {}) {
  const site = await repo.findSiteById(siteId);
  if (!site) throw new ApiError(404, 'site_not_found', 'Site not found');

  const container = await repo.findByIdForSession(containerId, session);
  // Scope to the site via the container's node; a container on another site's
  // node 404s exactly as an unknown id does (no cross-site existence leak).
  if (!container || !container.node || container.node.siteId !== site.id) {
    throw new ApiError(404, 'not_found', 'Container not found');
  }
  if (requireManage && !(session.isAdmin || container.canEdit(session.user))) {
    throw new ApiError(403, 'forbidden', 'Only the owner may manage this container');
  }
  return { site, container };
}

module.exports = { loadForSession };
