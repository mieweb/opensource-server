const { Site } = require('../models');

// Middleware to set req.session.currentSite based on the :siteId parameter
function setCurrentSite(req, res, next) {
  if (req.params.siteId) {
    req.session.currentSite = parseInt(req.params.siteId, 10);
    res.locals.currentSite = req.session.currentSite;
  }
  next();
}

// Middleware to load all sites and attach to res.locals for use in views
async function loadSites(req, res, next) {
  try {
    const sites = await Site.findAll({
      attributes: ['id', 'name'],
      order: [['name', 'ASC']]
    });
    res.locals.sites = sites;
    res.locals.currentSite = req.session.currentSite || null;
  } catch (error) {
    console.error('Error loading sites:', error);
    res.locals.sites = [];
    res.locals.currentSite = null;
  }
  next();
}

module.exports = { setCurrentSite, loadSites };
