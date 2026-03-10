const { Site, CustomTool, Group, CustomToolGroup } = require('../models');

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

// Middleware to load custom tools visible to the current user's groups
async function loadCustomTools(req, res, next) {
  try {
    if (!req.session || !req.session.user) {
      res.locals.customTools = [];
      return next();
    }

    const userGroupIds = req.session.userGroupIds || [];

    if (userGroupIds.length === 0) {
      res.locals.customTools = [];
      return next();
    }

    // Find custom tools that have at least one of the user's groups
    const tools = await CustomTool.findAll({
      include: [{
        model: Group,
        as: 'visibleToGroups',
        where: { gidNumber: userGroupIds },
        required: true,
        through: { model: CustomToolGroup, attributes: [] },
        attributes: []
      }],
      order: [['name', 'ASC']]
    });

    res.locals.customTools = tools.map(t => ({ id: t.id, name: t.name, url: t.url }));
  } catch (error) {
    console.error('Error loading custom tools:', error);
    res.locals.customTools = [];
  }
  next();
}

module.exports = { setCurrentSite, loadSites, loadCustomTools };
