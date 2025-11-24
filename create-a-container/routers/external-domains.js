const express = require('express');
const router = express.Router({ mergeParams: true }); // Enable access to :siteId param
const { ExternalDomain, Site, Sequelize } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

// All routes require authentication
router.use(requireAuth);

// GET /sites/:siteId/external-domains - List all external domains for this site
router.get('/', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const externalDomains = await ExternalDomain.findAll({
    where: { siteId },
    order: [['name', 'ASC']]
  });

  const rows = externalDomains.map(d => ({
    id: d.id,
    name: d.name,
    acmeEmail: d.acmeEmail,
    acmeDirectoryUrl: d.acmeDirectoryUrl,
    cloudflareApiEmail: d.cloudflareApiEmail
  }));

  return res.render('external-domains/index', {
    rows,
    site,
    req
  });
});

// GET /sites/:siteId/external-domains/new - Display form for creating a new external domain (admin only)
router.get('/new', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  return res.render('external-domains/form', {
    externalDomain: null,
    site,
    isEdit: false,
    req
  });
});

// GET /sites/:siteId/external-domains/:id/edit - Display form for editing an external domain (admin only)
router.get('/:id/edit', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const domainId = parseInt(req.params.id, 10);

  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const externalDomain = await ExternalDomain.findOne({
    where: { id: domainId, siteId }
  });

  if (!externalDomain) {
    req.flash('error', 'External domain not found');
    return res.redirect(`/sites/${siteId}/external-domains`);
  }

  return res.render('external-domains/form', {
    externalDomain,
    site,
    isEdit: true,
    req
  });
});

// POST /sites/:siteId/external-domains - Create a new external domain (admin only)
router.post('/', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);

  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  try {
    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey } = req.body;

    await ExternalDomain.create({
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null,
      cloudflareApiKey: cloudflareApiKey || null,
      siteId
    });

    req.flash('success', `External domain ${name} created successfully`);
    return res.redirect(`/sites/${siteId}/external-domains`);
  } catch (error) {
    console.error('Error creating external domain:', error);
    req.flash('error', 'Failed to create external domain: ' + error.message);
    return res.redirect(`/sites/${siteId}/external-domains/new`);
  }
});

// PUT /sites/:siteId/external-domains/:id - Update an external domain (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const domainId = parseInt(req.params.id, 10);

  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  try {
    const externalDomain = await ExternalDomain.findOne({
      where: { id: domainId, siteId }
    });

    if (!externalDomain) {
      req.flash('error', 'External domain not found');
      return res.redirect(`/sites/${siteId}/external-domains`);
    }

    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey } = req.body;

    const updateData = {
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null
    };
    
    // Only update cloudflareApiKey if a new value was provided
    if (cloudflareApiKey && cloudflareApiKey.trim() !== '') {
      updateData.cloudflareApiKey = cloudflareApiKey;
    }

    await externalDomain.update(updateData);

    req.flash('success', `External domain ${name} updated successfully`);
    return res.redirect(`/sites/${siteId}/external-domains`);
  } catch (error) {
    console.error('Error updating external domain:', error);
    req.flash('error', 'Failed to update external domain: ' + error.message);
    return res.redirect(`/sites/${siteId}/external-domains/${domainId}/edit`);
  }
});

// DELETE /sites/:siteId/external-domains/:id - Delete an external domain (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const domainId = parseInt(req.params.id, 10);

  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  try {
    const externalDomain = await ExternalDomain.findOne({
      where: { id: domainId, siteId }
    });

    if (!externalDomain) {
      req.flash('error', 'External domain not found');
      return res.redirect(`/sites/${siteId}/external-domains`);
    }

    const domainName = externalDomain.name;
    await externalDomain.destroy();

    req.flash('success', `External domain ${domainName} deleted successfully`);
    return res.redirect(`/sites/${siteId}/external-domains`);
  } catch (error) {
    console.error('Error deleting external domain:', error);
    req.flash('error', 'Failed to delete external domain: ' + error.message);
    return res.redirect(`/sites/${siteId}/external-domains`);
  }
});

module.exports = router;
