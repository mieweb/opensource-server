const express = require('express');
const router = express.Router();
const { Site, Node, Container, Service, ExternalDomain } = require('../models');
const { requireAuth, requireAdmin, requireLocalhost, setCurrentSite } = require('../middlewares');

// GET /sites/:siteId/dnsmasq.conf - Public endpoint for dnsmasq configuration
router.get('/:siteId/dnsmasq.conf', requireLocalhost, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        attributes: ['macAddress', 'ipv4Address', 'hostname']
      }]
    }]
  });
  
  if (!site) {
    return res.status(404).send('Site not found');
  }
  
  res.set('Content-Type', 'text/plain');
  return res.render('dnsmasq-conf', { site });
});

// GET /sites/:siteId/nginx.conf - Public endpoint for nginx configuration
router.get('/:siteId/nginx.conf', requireLocalhost, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  // fetch services for the specific site
  const site = await Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        include: [{
          model: Service,
          as: 'services'
        }]
      }]
    }, {
      model: ExternalDomain,
      as: 'externalDomains'
    }]
  });
  
  // Flatten services from site→nodes→containers→services
  const allServices = [];
  site?.nodes?.forEach(node => {
    node?.containers?.forEach(container => {
      container?.services?.forEach(service => {
        // Add container reference for template compatibility
        service.Container = container;
        allServices.push(service);
      });
    });
  });
  
  // Filter by type
  const httpServices = allServices.filter(s => s.type === 'http');
  const streamServices = allServices.filter(s => s.type === 'tcp' || s.type === 'udp');
  
  res.set('Content-Type', 'text/plain');
  return res.render('nginx-conf', { httpServices, streamServices, externalDomains: site?.externalDomains || [] });
});

// Apply auth to all routes below this point
router.use(requireAuth);

// store the current site for routes with :siteId
router.use('/:siteId', setCurrentSite);

// Mount sub-routers
const nodesRouter = require('./nodes');
const containersRouter = require('./containers');
const externalDomainsRouter = require('./external-domains');
router.use('/:siteId/nodes', nodesRouter);
router.use('/:siteId/containers', containersRouter);
router.use('/:siteId/external-domains', externalDomainsRouter);

// GET /sites - List all sites (available to all authenticated users)
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
    dhcpRange: s.dhcpRange,
    gateway: s.gateway,
    nodeCount: s.nodes ? s.nodes.length : 0
  }));

  return res.render('sites/index', {
    rows,
    req
  });
});

// GET /sites/new - Display form for creating a new site (admin only)
router.get('/new', requireAdmin, async (req, res) => {
  res.render('sites/form', {
    site: null,
    isEdit: false,
    req
  });
});

// GET /sites/:id/edit - Display form for editing an existing site (admin only)
router.get('/:id/edit', requireAdmin, async (req, res) => {
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

// POST /sites - Create a new site (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders } = req.body;
    
    await Site.create({
      name,
      internalDomain,
      dhcpRange,
      subnetMask,
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

// PUT /sites/:id - Update an existing site (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const site = await Site.findByPk(req.params.id);
    
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders } = req.body;
    
    await site.update({
      name,
      internalDomain,
      dhcpRange,
      subnetMask,
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

// DELETE /sites/:id - Delete a site (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
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
