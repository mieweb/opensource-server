const fp = require('fastify-plugin');

/**
 * Load sites plugin for Fastify
 * Loads all sites for authenticated users and attaches to reply.locals
 */
async function loadSitesPlugin(fastify, options) {
  const { Site } = require('../models');

  fastify.addHook('preHandler', async (request, reply) => {
    // Only load sites for authenticated users
    if (!request.session?.user) {
      return;
    }

    reply.locals = reply.locals || {};

    try {
      const sites = await Site.findAll({
        attributes: ['id', 'name'],
        order: [['name', 'ASC']]
      });
      reply.locals.sites = sites;
      reply.locals.currentSite = request.session.currentSite || null;
    } catch (error) {
      fastify.log.error('Error loading sites:', error);
      reply.locals.sites = [];
      reply.locals.currentSite = null;
    }
  });

  /**
   * Helper to set current site from route param
   */
  function setCurrentSite(request, reply) {
    if (request.params.siteId) {
      request.session.currentSite = parseInt(request.params.siteId, 10);
      reply.locals = reply.locals || {};
      reply.locals.currentSite = request.session.currentSite;
    }
  }

  fastify.decorate('setCurrentSite', setCurrentSite);
}

module.exports = fp(loadSitesPlugin, {
  name: 'load-sites',
  dependencies: ['@fastify/session']
});
