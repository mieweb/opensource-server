const { Site, Setting } = require('../models');

// Middleware to set req.session.currentSite based on the :siteId parameter
function setCurrentSite(req, res, next) {
  if (req.params.siteId) {
    req.session.currentSite = parseInt(req.params.siteId, 10);
    res.locals.currentSite = req.session.currentSite;
  }
  next();
}

// Middleware to load all sites and attach to res.locals for use in views.
// Also exposes a small set of layout-wide settings (e.g. push notification URL,
// used by the sidebar to render the MFA Admin link).
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

  try {
    const pushNotificationUrl = await Setting.get('push_notification_url');
    res.locals.pushNotificationUrl = pushNotificationUrl?.trim() || '';
  } catch (error) {
    console.error('Error loading push notification URL:', error);
    res.locals.pushNotificationUrl = '';
  }

  next();
}

module.exports = { setCurrentSite, loadSites };
