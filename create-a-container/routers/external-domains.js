const express = require('express');
const router = express.Router();
const { ExternalDomain, Site } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

// All routes require authentication + admin
router.use(requireAuth);
router.use(requireAdmin);

// GET /external-domains
router.get('/', async (req, res) => {
  const externalDomains = await ExternalDomain.findAll({
    include: [{ model: Site, as: 'site', attributes: ['id', 'name'], required: false }],
    order: [['name', 'ASC']]
  });

  const rows = externalDomains.map(d => ({
    id: d.id,
    name: d.name,
    acmeEmail: d.acmeEmail,
    acmeDirectoryUrl: d.acmeDirectoryUrl,
    cloudflareApiEmail: d.cloudflareApiEmail,
    defaultSite: d.site ? d.site.name : null
  }));

  return res.render('external-domains/index', { rows, req });
});

// GET /external-domains/new
router.get('/new', async (req, res) => {
  const sites = await Site.findAll({ order: [['name', 'ASC']] });
  return res.render('external-domains/form', {
    externalDomain: null,
    sites,
    isEdit: false,
    req
  });
});

// GET /external-domains/:id/edit
router.get('/:id/edit', async (req, res) => {
  const domainId = parseInt(req.params.id, 10);

  const externalDomain = await ExternalDomain.findByPk(domainId);
  if (!externalDomain) {
    await req.flash('error', 'External domain not found');
    return res.redirect('/external-domains');
  }

  const sites = await Site.findAll({ order: [['name', 'ASC']] });
  return res.render('external-domains/form', {
    externalDomain,
    sites,
    isEdit: true,
    req
  });
});

// POST /external-domains
router.post('/', async (req, res) => {
  try {
    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId } = req.body;

    await ExternalDomain.create({
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null,
      cloudflareApiKey: cloudflareApiKey || null,
      siteId: siteId || null
    });

    await req.flash('success', `External domain ${name} created successfully`);

    return res.redirect('/external-domains');
  } catch (error) {
    console.error('Error creating external domain:', error);
    await req.flash('error', 'Failed to create external domain: ' + error.message);
    return res.redirect('/external-domains/new');
  }
});

// PUT /external-domains/:id
router.put('/:id', async (req, res) => {
  const domainId = parseInt(req.params.id, 10);

  try {
    const externalDomain = await ExternalDomain.findByPk(domainId);

    if (!externalDomain) {
      await req.flash('error', 'External domain not found');
      return res.redirect('/external-domains');
    }

    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId } = req.body;

    const updateData = {
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null,
      siteId: siteId || null
    };
    
    // Only update cloudflareApiKey if a new value was provided
    if (cloudflareApiKey && cloudflareApiKey.trim() !== '') {
      updateData.cloudflareApiKey = cloudflareApiKey;
    }

    await externalDomain.update(updateData);

    await req.flash('success', `External domain ${name} updated successfully`);
    return res.redirect('/external-domains');
  } catch (error) {
    console.error('Error updating external domain:', error);
    await req.flash('error', 'Failed to update external domain: ' + error.message);
    return res.redirect(`/external-domains/${domainId}/edit`);
  }
});

// DELETE /external-domains/:id
router.delete('/:id', async (req, res) => {
  const domainId = parseInt(req.params.id, 10);

  try {
    const externalDomain = await ExternalDomain.findByPk(domainId);

    if (!externalDomain) {
      await req.flash('error', 'External domain not found');
      return res.redirect('/external-domains');
    }

    const domainName = externalDomain.name;
    await externalDomain.destroy();

    await req.flash('success', `External domain ${domainName} deleted successfully`);
    return res.redirect('/external-domains');
  } catch (error) {
    console.error('Error deleting external domain:', error);
    await req.flash('error', 'Failed to delete external domain: ' + error.message);
    return res.redirect('/external-domains');
  }
});

module.exports = router;
