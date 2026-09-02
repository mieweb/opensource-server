const { Site } = require('../../models');

async function findSiteById(id) {
  return Site.findByPk(id);
}

module.exports = { findSiteById };
