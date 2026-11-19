/**
 * OAuth 2.1 authorization server routes (oidc-provider). Three routers
 * because they sit at different points of the app middleware stack (app.js):
 *
 *   wellKnownRouter    /.well-known/*  discovery, unauthenticated GETs
 *   providerRouter     /oauth/*        everything the provider answers. Called
 *                      by MCP clients with no session cookie and no Bearer
 *                      token, so mounted BEFORE session + csrfGuard, with its
 *                      own body parsers and rate limits
 *   interactionRouter  /oauth/interaction/:uid  sign-in check + consent page.
 *                      Needs the manager session; the consent POST stays
 *                      CSRF-protected, so mounted after both
 */

const express = require('express');
const { createProviderRegistry } = require('./provider');
const { createController } = require('./controller');
const { rateLimit } = require('../../middlewares/rate-limit');

const MINUTE = 60 * 1000;

/**
 * @param {object} opts
 * @param {string[]} opts.cookieKeys keys for the provider's own signed cookies
 */
function createOAuthRouters({ cookieKeys }) {
  const ctrl = createController(createProviderRegistry({ cookieKeys }));

  const wellKnownRouter = express.Router();
  wellKnownRouter.get('/oauth-protected-resource', ctrl.protectedResource(''));
  wellKnownRouter.get('/oauth-protected-resource/mcp', ctrl.protectedResource('/mcp'));
  wellKnownRouter.all(['/oauth-authorization-server', '/openid-configuration'], ctrl.rootDiscovery);

  const providerRouter = express.Router();
  const limit = (windowMs, max) => rateLimit({ windowMs, max, onLimit: ctrl.rateLimited });
  const tokenLimit = limit(MINUTE, 60);
  const body = [express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' })];
  // Leave the browser interaction to interactionRouter (mounted later).
  providerRouter.use('/interaction', (req, res, next) => next('router'));
  providerRouter.post('/register', limit(10 * MINUTE, 20), express.json({ limit: '16kb' }), ctrl.checkRegistration);
  providerRouter.post(['/token', '/revoke'], tokenLimit, ...body, ctrl.hashClientSecret);
  providerRouter.use(ctrl.oauthErrorHandler);
  providerRouter.use(ctrl.provider);

  const interactionRouter = express.Router();
  interactionRouter.get('/:uid', ctrl.interactionGet);
  interactionRouter.post('/:uid', ctrl.interactionPost);

  return { wellKnownRouter, providerRouter, interactionRouter };
}

module.exports = { createOAuthRouters };
