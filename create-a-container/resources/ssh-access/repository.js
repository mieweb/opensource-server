const { Container } = require('../../models');

// Load a container by id with its collaborators eager-loaded — the association
// sshAllowsUser needs immediately after auth. Returns null when absent; the
// service decides what a missing/invalid container means (401 here, since the
// caller authenticates *as* the container).
async function findWithCollaborators(id) {
  return Container.findByPk(id, { include: [{ association: 'collaborators' }] });
}

module.exports = { findWithCollaborators };
