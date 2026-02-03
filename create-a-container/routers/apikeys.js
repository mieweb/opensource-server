const express = require('express');
const router = express.Router();
const { ApiKey, User } = require('../models');
const { requireAuth } = require('../middlewares');
const { createApiKeyData } = require('../utils/apikey');

// Apply auth to all routes - users can only manage their own API keys
router.use(requireAuth);

// GET /apikeys - List all API keys for the current user
router.get('/', async (req, res) => {
  const user = await User.findOne({ where: { uid: req.session.user } });
  if (!user) {
    await req.flash('error', 'User not found');
    return res.redirect('/login');
  }
  
  const apiKeys = await ApiKey.findAll({
    where: { uidNumber: user.uidNumber },
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt']
  });

  // Check if this is an API request
  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  
  if (acceptsJSON || isAjax) {
    return res.json({ apiKeys });
  }

  return res.render('apikeys/index', {
    apiKeys,
    req
  });
});

// GET /apikeys/new - Display form for creating a new API key
router.get('/new', (req, res) => {
  return res.render('apikeys/form', {
    req
  });
});

// POST /apikeys - Create a new API key
router.post('/', async (req, res) => {
  const user = await User.findOne({ where: { uid: req.session.user } });
  if (!user) {
    await req.flash('error', 'User not found');
    return res.redirect('/login');
  }
  
  const { description } = req.body;

  const apiKeyData = await createApiKeyData(user.uidNumber, description);
  
  // Store the hashed key in the database
  const apiKey = await ApiKey.create({
    uidNumber: apiKeyData.uidNumber,
    keyPrefix: apiKeyData.keyPrefix,
    keyHash: apiKeyData.keyHash,
    description: apiKeyData.description
  });

  // Check if this is an API request
  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  
  if (acceptsJSON || isAjax) {
    return res.status(201).json({
      apiKey: {
        id: apiKey.id,
        key: apiKeyData.plainKey, // Only shown once!
        keyPrefix: apiKey.keyPrefix,
        description: apiKey.description,
        createdAt: apiKey.createdAt
      },
      warning: 'This is the only time the full API key will be displayed. Please store it securely.'
    });
  }

  await req.flash('success', 'API key created successfully. This is the only time it will be shown!');
  return res.render('apikeys/created', {
    plainKey: apiKeyData.plainKey,
    apiKey,
    req
  });
});

// GET /apikeys/:id - Show details of a specific API key
router.get('/:id', async (req, res) => {
  const user = await User.findOne({ where: { uid: req.session.user } });
  if (!user) {
    await req.flash('error', 'User not found');
    return res.redirect('/login');
  }
  
  const id = req.params.id;
  
  const apiKey = await ApiKey.findOne({
    where: { 
      id,
      uidNumber: user.uidNumber // Ensure user can only view their own keys
    },
    attributes: ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt']
  });

  if (!apiKey) {
    const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    
    if (acceptsJSON || isAjax) {
      return res.status(404).json({ error: 'API key not found' });
    }
    
    await req.flash('error', 'API key not found');
    return res.redirect('/apikeys');
  }

  // Check if this is an API request
  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  
  if (acceptsJSON || isAjax) {
    return res.json({ apiKey });
  }

  return res.render('apikeys/show', {
    apiKey,
    req
  });
});

// DELETE /apikeys/:id - Delete an API key
router.delete('/:id', async (req, res) => {
  const user = await User.findOne({ where: { uid: req.session.user } });
  if (!user) {
    await req.flash('error', 'User not found');
    return res.redirect('/login');
  }
  
  const id = req.params.id;
  
  const apiKey = await ApiKey.findOne({
    where: { 
      id,
      uidNumber: user.uidNumber // Ensure user can only delete their own keys
    }
  });

  if (!apiKey) {
    const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    
    if (acceptsJSON || isAjax) {
      return res.status(404).json({ error: 'API key not found' });
    }
    
    await req.flash('error', 'API key not found');
    return res.redirect('/apikeys');
  }

  await apiKey.destroy();

  // Check if this is an API request
  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  
  if (acceptsJSON || isAjax) {
    return res.status(204).send();
  }

  await req.flash('success', 'API key deleted successfully');
  return res.redirect('/apikeys');
});

module.exports = router;
