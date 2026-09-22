/**
 * Minimal containers repository — the query seam other resources need before
 * the full containers migration (see docs/mvc-manifesto.md §6, phase 7). Only
 * the pieces required to load and authorize a single container by id are here;
 * the legacy routers/api/v1/containers.js keeps its own copies until it is
 * migrated. Sequelize only — no HTTP concepts, no ApiError (manifesto §2).
 */

const {
  Container,
  ContainerCollaborator,
  Sequelize,
  sequelize,
} = require('../../models');

/**
 * The owner-or-shared visibility rule as a fragment of Sequelize clauses to OR
 * together: a container is visible to a user if they own it or it has been
 * shared with them. Expressed as an `IN (SELECT …)` subquery so the check
 * resolves inside the caller's query (one round trip) without a JOIN that would
 * truncate the eager-loaded collaborators list. Built with the dialect's query
 * generator so quoting/escaping stay correct across sqlite/mysql/postgres;
 * selectQuery emits a trailing ';' invalid inside IN (…), hence the slice.
 * @param {string} username - The requesting user's uid.
 * @returns {object[]} Clauses to OR together (own + shared).
 */
function visibleToClauses(username) {
  const shared = sequelize.dialect.queryGenerator
    .selectQuery(
      ContainerCollaborator.getTableName(),
      { attributes: ['containerId'], where: { username } },
      ContainerCollaborator,
    )
    .slice(0, -1);
  return [{ username }, { id: { [Sequelize.Op.in]: Sequelize.literal(`(${shared})`) } }];
}

/** Load a site by id, or null. */
async function findSiteById(siteId) {
  return Site.findByPk(parseInt(siteId, 10));
}

/**
 * Load one container by id, enforcing view access in the query: a non-admin
 * only ever matches a container they own or one shared with them, so an
 * unauthorized row never comes back (the service turns "no row" into a 404
 * that leaks nothing). Eager-loads node + collaborators.
 * @param {number} id - container id (already validated as a positive integer)
 * @param {object} session - { user, isAdmin }
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function findByIdForSession(id, session) {
  const where = { id };
  if (!session.isAdmin) {
    where[Sequelize.Op.or] = visibleToClauses(session.user);
  }
  return Container.findOne({
    where,
    include: [{ association: 'node' }, { association: 'collaborators' }],
  });
}

module.exports = { visibleToClauses, findByIdForSession };
