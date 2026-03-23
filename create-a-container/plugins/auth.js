const fp = require('fastify-plugin');

/**
 * Authentication plugin for Fastify
 * Provides session and API key authentication with admin checks
 */
async function authPlugin(fastify, options) {
  // Helper to check if request wants JSON response
  function isApiRequest(request) {
    const acceptHeader = request.headers.accept || '';
    const acceptsJSON = acceptHeader.includes('application/json') || acceptHeader.includes('application/vnd.api+json');
    const isAjax = request.headers['x-requested-with'] === 'XMLHttpRequest';
    const isApiPath = request.url?.startsWith('/api/');
    return acceptsJSON || isAjax || isApiPath;
  }

  // Decorate request with helper
  fastify.decorateRequest('isApiRequest', function() {
    return isApiRequest(this);
  });

  // Decorate request with user-related properties
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('apiKey', null);
  fastify.decorateRequest('isAdmin', false);

  /**
   * Authentication hook - validates session or API key
   */
  async function requireAuth(request, reply) {
    // First check session authentication
    if (request.session?.user) {
      request.isAdmin = request.session.isAdmin || false;
      return;
    }

    // Try API key authentication
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const apiKey = authHeader.substring(7);

      if (apiKey) {
        const { ApiKey, User } = require('../models');
        const { extractKeyPrefix } = require('../utils/apikey');

        const keyPrefix = extractKeyPrefix(apiKey);

        const apiKeys = await ApiKey.findAll({
          where: { keyPrefix },
          include: [{
            model: User,
            as: 'user',
            include: [{ association: 'groups' }]
          }]
        });

        for (const storedKey of apiKeys) {
          const isValid = await storedKey.validateKey(apiKey);
          if (isValid) {
            request.user = storedKey.user;
            request.apiKey = storedKey;
            request.isAdmin = storedKey.user.groups?.some(g => g.isAdmin) || false;

            // Populate session for compatibility
            request.session.user = storedKey.user.uid;
            request.session.isAdmin = request.isAdmin;

            // Record usage asynchronously
            storedKey.recordUsage().catch(err => {
              fastify.log.error('Failed to update API key last used timestamp:', err);
            });

            return;
          }
        }
      }
    }

    // Neither session nor API key authentication succeeded
    if (isApiRequest(request)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Browser request - redirect to login
    const original = request.url || '/';
    const redirectTo = '/login?redirect=' + encodeURIComponent(original);
    return reply.redirect(redirectTo);
  }

  /**
   * Admin check hook - must be used after requireAuth
   */
  async function requireAdmin(request, reply) {
    if (request.session?.isAdmin || request.isAdmin) {
      return;
    }

    if (isApiRequest(request)) {
      return reply.code(403).send({ error: 'Forbidden: Admin access required' });
    }

    return reply.code(403).send('Forbidden: Admin access required');
  }

  /**
   * Localhost or admin check hook
   * Allows localhost requests without auth; remote requests need admin
   */
  async function requireLocalhostOrAdmin(request, reply) {
    const isLocalhost = (ip) => {
      return ip === '127.0.0.1' ||
             ip === '::1' ||
             ip === '::ffff:127.0.0.1' ||
             ip === 'localhost';
    };

    const directIp = request.ip;
    const realIp = request.headers['x-real-ip'];

    // If direct connection is from localhost and no non-localhost X-Real-IP, allow through
    if (isLocalhost(directIp) && (!realIp || isLocalhost(realIp))) {
      return;
    }

    // Not localhost — require auth + admin
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireAdmin(request, reply);
  }

  // Decorate fastify with auth hooks so routes can use them
  fastify.decorate('requireAuth', requireAuth);
  fastify.decorate('requireAdmin', requireAdmin);
  fastify.decorate('requireLocalhostOrAdmin', requireLocalhostOrAdmin);

  // Also expose isApiRequest as a utility
  fastify.decorate('isApiRequest', isApiRequest);
}

module.exports = fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/session']
});
