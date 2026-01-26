const express = require('express');
const router = express.Router();
const { OAuthClient, User } = require('../models');
const { requireAuth } = require('../middlewares');

// Require authentication for all OAuth client routes
router.use(requireAuth);

/**
 * GET /oauth-clients
 * List all OAuth clients owned by the current user
 */
router.get('/', async (req, res) => {
  const clients = await OAuthClient.findAll({
    where: { ownerUidNumber: req.session.user.uidNumber },
    include: [{
      model: User,
      as: 'owner',
      attributes: ['uidNumber', 'uid', 'cn', 'mail']
    }],
    order: [['createdAt', 'DESC']]
  });

  res.render('oauth-clients/index', {
    clients,
    user: req.session.user,
    messages: {
      success: req.flash('success'),
      error: req.flash('error')
    }
  });
});

/**
 * GET /oauth-clients/new
 * Show form to create a new OAuth client
 */
router.get('/new', (req, res) => {
  res.render('oauth-clients/new', {
    user: req.session.user,
    messages: {
      error: req.flash('error')
    }
  });
});

/**
 * POST /oauth-clients
 * Create a new OAuth client
 */
router.post('/', async (req, res) => {
  const { clientName, redirectUris, grantTypes, responseTypes, scopes } = req.body;

  // Validate input
  if (!clientName || !redirectUris) {
    req.flash('error', 'Client name and redirect URIs are required');
    return res.redirect('/oauth-clients/new');
  }

  // Parse redirect URIs (comma or newline separated)
  const uriArray = redirectUris
    .split(/[\n,]/)
    .map(uri => uri.trim())
    .filter(uri => uri.length > 0);

  if (uriArray.length === 0) {
    req.flash('error', 'At least one redirect URI is required');
    return res.redirect('/oauth-clients/new');
  }

  // Validate URIs
  for (const uri of uriArray) {
    try {
      new URL(uri);
    } catch (e) {
      req.flash('error', `Invalid URI: ${uri}`);
      return res.redirect('/oauth-clients/new');
    }
  }

  // Parse grant types, response types, and scopes
  const grantTypesArray = Array.isArray(grantTypes) 
    ? grantTypes 
    : (grantTypes ? [grantTypes] : ['authorization_code', 'refresh_token']);
  
  const responseTypesArray = Array.isArray(responseTypes)
    ? responseTypes
    : (responseTypes ? [responseTypes] : ['code']);
  
  const scopesArray = Array.isArray(scopes)
    ? scopes
    : (scopes ? [scopes] : ['openid', 'profile', 'email', 'groups']);

  // Generate client ID and secret
  const clientId = OAuthClient.generateClientId();
  const clientSecret = OAuthClient.generateClientSecret();

  const client = await OAuthClient.create({
    clientId,
    clientSecret,
    clientName,
    redirectUris: uriArray,
    grantTypes: grantTypesArray,
    responseTypes: responseTypesArray,
    scopes: scopesArray,
    ownerUidNumber: req.session.user.uidNumber
  });

  req.flash('success', 'OAuth client created successfully');
  res.redirect(`/oauth-clients/${client.clientId}`);
});

/**
 * GET /oauth-clients/:clientId
 * Show details of a specific OAuth client
 */
router.get('/:clientId', async (req, res) => {
  const client = await OAuthClient.findOne({
    where: { 
      clientId: req.params.clientId,
      ownerUidNumber: req.session.user.uidNumber
    },
    include: [{
      model: User,
      as: 'owner',
      attributes: ['uidNumber', 'uid', 'cn', 'mail']
    }]
  });

  if (!client) {
    req.flash('error', 'OAuth client not found or access denied');
    return res.redirect('/oauth-clients');
  }

  res.render('oauth-clients/show', {
    client,
    user: req.session.user,
    messages: {
      success: req.flash('success'),
      error: req.flash('error')
    }
  });
});

/**
 * GET /oauth-clients/:clientId/edit
 * Show form to edit an OAuth client
 */
router.get('/:clientId/edit', async (req, res) => {
  const client = await OAuthClient.findOne({
    where: { 
      clientId: req.params.clientId,
      ownerUidNumber: req.session.user.uidNumber
    }
  });

  if (!client) {
    req.flash('error', 'OAuth client not found or access denied');
    return res.redirect('/oauth-clients');
  }

  res.render('oauth-clients/edit', {
    client,
    user: req.session.user,
    messages: {
      error: req.flash('error')
    }
  });
});

/**
 * PUT /oauth-clients/:clientId
 * Update an OAuth client
 */
router.put('/:clientId', async (req, res) => {
  const { clientName, redirectUris, grantTypes, responseTypes, scopes } = req.body;

  const client = await OAuthClient.findOne({
    where: { 
      clientId: req.params.clientId,
      ownerUidNumber: req.session.user.uidNumber
    }
  });

  if (!client) {
    req.flash('error', 'OAuth client not found or access denied');
    return res.redirect('/oauth-clients');
  }

  // Validate input
  if (!clientName || !redirectUris) {
    req.flash('error', 'Client name and redirect URIs are required');
    return res.redirect(`/oauth-clients/${client.clientId}/edit`);
  }

  // Parse redirect URIs
  const uriArray = redirectUris
    .split(/[\n,]/)
    .map(uri => uri.trim())
    .filter(uri => uri.length > 0);

  if (uriArray.length === 0) {
    req.flash('error', 'At least one redirect URI is required');
    return res.redirect(`/oauth-clients/${client.clientId}/edit`);
  }

  // Validate URIs
  for (const uri of uriArray) {
    try {
      new URL(uri);
    } catch (e) {
      req.flash('error', `Invalid URI: ${uri}`);
      return res.redirect(`/oauth-clients/${client.clientId}/edit`);
    }
  }

  // Parse arrays
  const grantTypesArray = Array.isArray(grantTypes) 
    ? grantTypes 
    : (grantTypes ? [grantTypes] : ['authorization_code', 'refresh_token']);
  
  const responseTypesArray = Array.isArray(responseTypes)
    ? responseTypes
    : (responseTypes ? [responseTypes] : ['code']);
  
  const scopesArray = Array.isArray(scopes)
    ? scopes
    : (scopes ? [scopes] : ['openid', 'profile', 'email', 'groups']);

  // Update client
  await client.update({
    clientName,
    redirectUris: uriArray,
    grantTypes: grantTypesArray,
    responseTypes: responseTypesArray,
    scopes: scopesArray
  });

  req.flash('success', 'OAuth client updated successfully');
  res.redirect(`/oauth-clients/${client.clientId}`);
});

/**
 * DELETE /oauth-clients/:clientId
 * Delete an OAuth client
 */
router.delete('/:clientId', async (req, res) => {
  const client = await OAuthClient.findOne({
    where: { 
      clientId: req.params.clientId,
      ownerUidNumber: req.session.user.uidNumber
    }
  });

  if (!client) {
    req.flash('error', 'OAuth client not found or access denied');
    return res.redirect('/oauth-clients');
  }

  await client.destroy();

  req.flash('success', 'OAuth client deleted successfully');
  res.redirect('/oauth-clients');
});

/**
 * POST /oauth-clients/:clientId/regenerate-secret
 * Regenerate the client secret
 */
router.post('/:clientId/regenerate-secret', async (req, res) => {
  const client = await OAuthClient.findOne({
    where: { 
      clientId: req.params.clientId,
      ownerUidNumber: req.session.user.uidNumber
    }
  });

  if (!client) {
    req.flash('error', 'OAuth client not found or access denied');
    return res.redirect('/oauth-clients');
  }

  const newSecret = OAuthClient.generateClientSecret();
  await client.update({ clientSecret: newSecret });

  req.flash('success', 'Client secret regenerated successfully');
  res.redirect(`/oauth-clients/${client.clientId}`);
});

module.exports = router;
