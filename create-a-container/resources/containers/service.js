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
 * Load a container by its (globally unique) id and authorize the session
 * against it. View access is enforced in the query
 * (repository.findByIdForSession): a non-admin only loads a container they own
 * or one shared with them, so an unauthorized row never comes back and this
 * 404s without leaking existence. Manage access (owner/admin — sharing, delete,
 * token mint) is checked here and returns 403: the caller can already view the
 * container, so it leaks nothing new and tells a collaborator why they can't
 * manage it.
 *
 * A container is identified by id alone — no site is needed (the id is the PK).
 * @param {number} id - Container id (already validated positive int).
 * @param {object} session - { user, isAdmin }.
 * @param {object} [opts]
 * @param {boolean} [opts.requireManage=false] - Require owner/admin.
 * @returns {Promise<object>} The authorized container (node + collaborators loaded).
 */
async function loadByIdForSession(id, session, { requireManage = false } = {}) {
  const container = await repo.findByIdForSession(id, session);
  if (!container) {
    throw new ApiError(404, 'not_found', 'Container not found');
  }
  if (requireManage && !(session.isAdmin || container.canEdit(session.user))) {
    throw new ApiError(403, 'forbidden', 'Only the owner may manage this container');
  }
  return container;
}

module.exports = { loadByIdForSession };
