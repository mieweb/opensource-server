const express = require('express');
const router = express.Router();
const { User, Group } = require('../models');

/**
 * GET /oidc/interaction/:uid
 * Handle OIDC interaction (login/consent)
 */
router.get('/interaction/:uid', async (req, res, next) => {
  try {
    const provider = req.app.get('oidcProvider');
    const details = await provider.interactionDetails(req, res);

    const { uid, prompt, params } = details;

    // If user is not logged in, redirect to login
    if (prompt.name === 'login') {
      // Check if user is already authenticated via session
      if (req.session.user) {
        // User is logged in, complete the login interaction
        return res.redirect(`/oidc/interaction/${uid}/login`);
      }

      // Store interaction UID in session for post-login redirect
      req.session.oidcInteractionUid = uid;
      req.session.returnTo = `/oidc/interaction/${uid}/login`;
      
      return res.redirect('/login');
    }

    // Handle consent prompt
    if (prompt.name === 'consent') {
      return res.render('oidc/consent', {
        uid,
        details,
        client: params,
        user: req.session.user,
        messages: {}
      });
    }

    // Unknown prompt
    return res.status(400).send('Unknown prompt');
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /oidc/interaction/:uid/login
 * Complete login interaction
 */
router.get('/interaction/:uid/login', async (req, res, next) => {
  if (!req.session.user) {
    req.session.returnTo = `/oidc/interaction/${req.params.uid}/login`;
    return res.redirect('/login');
  }

  try {
    const provider = req.app.get('oidcProvider');
    const details = await provider.interactionDetails(req, res);

    await provider.interactionFinished(req, res, {
      login: {
        accountId: String(req.session.user.uidNumber),
      }
    }, { mergeWithLastSubmission: false });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /oidc/interaction/:uid/confirm
 * Confirm consent
 */
router.post('/interaction/:uid/confirm', async (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const provider = req.app.get('oidcProvider');
    const details = await provider.interactionDetails(req, res);

    const { prompt: { name, details: promptDetails }, params } = details;

    if (name !== 'consent') {
      return res.status(400).send('Invalid prompt');
    }

    const grant = new provider.Grant({
      accountId: String(req.session.user.uidNumber),
      clientId: params.client_id,
    });

    // Add requested scopes
    if (promptDetails.missingOIDCScope) {
      grant.addOIDCScope(promptDetails.missingOIDCScope.join(' '));
    }

    if (promptDetails.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(promptDetails.missingResourceScopes)) {
        grant.addResourceScope(indicator, scopes.join(' '));
      }
    }

    const grantId = await grant.save();

    await provider.interactionFinished(req, res, {
      consent: {
        grantId
      }
    }, { mergeWithLastSubmission: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /oidc/interaction/:uid/abort
 * Abort/deny the interaction
 */
router.post('/interaction/:uid/abort', async (req, res, next) => {
  try {
    const provider = req.app.get('oidcProvider');
    await provider.interactionFinished(req, res, {
      error: 'access_denied',
      error_description: 'User denied access'
    }, { mergeWithLastSubmission: false });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
