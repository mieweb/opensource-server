const express = require('express');
const router = express.Router();
const { Site, Node } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

// Apply auth and admin check to all routes
router.use(requireAuth);
router.use(requireAdmin);

// GET /sites - List all sites
router.get('/', async (req, res) => {
  const sites = await Site.findAll({
    include: [{
      model: Node,
      as: 'nodes',
      attributes: ['id', 'name']
    }],
    order: [['id', 'ASC']]
  });

  const rows = sites.map(s => ({
    id: s.id,
    name: s.name,
    internalDomain: s.internalDomain,
    subnet: s.subnet,
    gateway: s.gateway,
    nodeCount: s.nodes ? s.nodes.length : 0
  }));

  return res.render('sites/index', {
    rows,
    req
  });
});

// GET /sites/new - Display form for creating a new site
router.get('/new', async (req, res) => {
  res.render('sites/form', {
    site: null,
    isEdit: false,
    req
  });
});

// GET /sites/:id/edit - Display form for editing an existing site
router.get('/:id/edit', async (req, res) => {
  const site = await Site.findByPk(req.params.id);
  
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  res.render('sites/form', {
    site,
    isEdit: true,
    req
  });
});

// POST /sites - Create a new site
router.post('/', async (req, res) => {
  try {
    const { name, internalDomain, subnet, gateway, dnsForwarders } = req.body;
    
    await Site.create({
      name,
      internalDomain,
      subnet,
      gateway,
      dnsForwarders
    });

    req.flash('success', `Site ${name} created successfully`);
    return res.redirect('/sites');
  } catch (error) {
    console.error('Error creating site:', error);
    req.flash('error', 'Failed to create site: ' + error.message);
    return res.redirect('/sites/new');
  }
});

// PUT /sites/:id - Update an existing site
router.put('/:id', async (req, res) => {
  try {
    const site = await Site.findByPk(req.params.id);
    
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const { name, internalDomain, subnet, gateway, dnsForwarders } = req.body;
    
    await site.update({
      name,
      internalDomain,
      subnet,
      gateway,
      dnsForwarders
    });

    req.flash('success', `Site ${name} updated successfully`);
    return res.redirect('/sites');
  } catch (error) {
    console.error('Error updating site:', error);
    req.flash('error', 'Failed to update site: ' + error.message);
    return res.redirect(`/sites/${req.params.id}/edit`);
  }
});

// DELETE /sites/:id - Delete a site
router.delete('/:id', async (req, res) => {
  try {
    const site = await Site.findByPk(req.params.id, {
      include: [{ model: Node, as: 'nodes' }]
    });
    
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    if (site.nodes && site.nodes.length > 0) {
      req.flash('error', 'Cannot delete site with associated nodes');
      return res.redirect('/sites');
    }

    const siteName = site.name;
    await site.destroy();

    req.flash('success', `Site ${siteName} deleted successfully`);
    return res.redirect('/sites');
  } catch (error) {
    console.error('Error deleting site:', error);
    req.flash('error', 'Failed to delete site: ' + error.message);
    return res.redirect('/sites');
  }
});

module.exports = router;
