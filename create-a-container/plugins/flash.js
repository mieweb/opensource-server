const fp = require('fastify-plugin');

/**
 * Flash messages plugin for Fastify
 * Provides Express-compatible flash() functionality using sessions
 */
async function flashPlugin(fastify, options) {
  // Decorate request with flash method
  fastify.decorateRequest('flash', function(type, message) {
    if (!this.session) {
      throw new Error('Flash requires session support');
    }

    // Initialize flash storage
    if (!this.session.flash) {
      this.session.flash = {};
    }

    // If no arguments, return and clear all flash messages
    if (arguments.length === 0) {
      const messages = this.session.flash || {};
      this.session.flash = {};
      return messages;
    }

    // If only type provided, return messages for that type
    if (arguments.length === 1) {
      const messages = this.session.flash[type] || [];
      delete this.session.flash[type];
      return messages;
    }

    // Add message to flash
    if (!this.session.flash[type]) {
      this.session.flash[type] = [];
    }
    this.session.flash[type].push(message);

    return this.session.flash[type].length;
  });

  // Pre-handler to expose flash messages to reply.locals for templates
  // that read from locals directly (login, register, reset-password).
  // Don't clear here — header.ejs calls req.flash() which handles clearing.
  fastify.addHook('preHandler', async (request, reply) => {
    reply.locals = reply.locals || {};
    const flashMessages = request.session?.flash || {};
    reply.locals.successMessages = flashMessages.success || [];
    reply.locals.errorMessages = flashMessages.error || [];
    reply.locals.warningMessages = flashMessages.warning || [];
    reply.locals.infoMessages = flashMessages.info || [];
  });
}

module.exports = fp(flashPlugin, {
  name: 'flash',
  dependencies: ['@fastify/session']
});
