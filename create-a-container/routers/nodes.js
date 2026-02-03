const express = require('express');
const router = express.Router({ mergeParams: true }); // Enable access to :siteId param
const { Node, Container, Site } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');
const axios = require('axios');
const https = require('https');
const ProxmoxApi = require('../utils/proxmox-api');

// Apply auth and admin check to all routes
router.use(requireAuth);
router.use(requireAdmin);

// GET /sites/:siteId/nodes - List all nodes for a site
router.get('/', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const nodes = await Node.findAll({
    where: { siteId },
    include: [{ 
      model: Container, 
      as: 'containers',
      attributes: ['id']
    }],
    attributes: { exclude: ['secret'] } // Never send secret to frontend
  });

  const rows = nodes.map(n => ({
    id: n.id,
    name: n.name,
    ipv4Address: n.ipv4Address,
    apiUrl: n.apiUrl,
    tlsVerify: n.tlsVerify,
    containerCount: n.containers ? n.containers.length : 0
  }));

  return res.render('nodes/index', {
    rows,
    site,
    req
  });
});

// GET /sites/:siteId/nodes/new - Display form for creating a new node
router.get('/new', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  res.render('nodes/form', {
    node: null,
    site,
    isEdit: false,
    req
  });
});

// GET /sites/:siteId/nodes/import - Display form for importing nodes
router.get('/import', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);

  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  return res.render('nodes/import', { site, req });
});

// GET /sites/:siteId/nodes/:id/edit - Display form for editing an existing node
router.get('/:id/edit', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const nodeId = parseInt(req.params.id, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }
  
  const node = await Node.findOne({
    where: { id: nodeId, siteId },
    attributes: { exclude: ['secret'] } // Never send secret to frontend
  });
  
  if (!node) {
    req.flash('error', 'Node not found');
    return res.redirect(`/sites/${siteId}/nodes`);
  }

  res.render('nodes/form', {
    node,
    site,
    isEdit: true,
    req
  });
});

// POST /sites/:siteId/nodes - Create a new node
router.post('/', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  try {
    const site = await Site.findByPk(siteId);
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const { name, ipv4Address, apiUrl, tokenId, secret, tlsVerify, imageStorage } = req.body;
    
    await Node.create({
      name,
      ipv4Address: ipv4Address || null,
      apiUrl: apiUrl || null,
      tokenId: tokenId || null,
      secret: secret || null,
      tlsVerify: tlsVerify === '' || tlsVerify === null ? null : tlsVerify === 'true',
      imageStorage: imageStorage || 'local',
      siteId
    });

    req.flash('success', `Node ${name} created successfully`);
    return res.redirect(`/sites/${siteId}/nodes`);
  } catch (err) {
    console.error('Error creating node:', err);
    req.flash('error', `Failed to create node: ${err.message}`);
    return res.redirect(`/sites/${siteId}/nodes/new`);
  }
});

// POST /sites/:siteId/nodes/import - Import nodes from Proxmox API
router.post('/import', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const { apiUrl, username, password, tlsVerify } = req.body;
  const httpsAgent = new https.Agent({ rejectUnauthorized: tlsVerify !== 'false' });
  const tokenId = username;
  const secret = password;

  // Create temporary node instance to use api() method for authentication
  try {
    const tempNode = Node.build({
      name: 'temp',
      apiUrl,
      tokenId,
      secret,
      tlsVerify: tlsVerify !== 'false'
    });

    const client = await tempNode.api();
    const nodes = await client.nodes();
    
    // Fetch network information and storage for each node
    const nodesWithIp = await Promise.all(nodes.map(async (n) => {
      let ipv4Address = null;
      let imageStorage = 'local';

      try {
        const networkInterfaces = await client.nodeNetwork(n.node);
        // Find the primary network interface (usually vmbr0 or the one with type 'bridge' and active)
        const primaryInterface = networkInterfaces.find(iface => 
          iface.iface === 'vmbr0' || (iface.type === 'bridge' && iface.active)
        );
        ipv4Address = primaryInterface?.address || null;
      } catch (err) {
        console.error(`Failed to fetch network info for node ${n.node}:`, err.message);
      }

      // Find largest storage supporting CT templates (vztmpl)
      try {
        const storages = await client.datastores(n.node, 'vztmpl', true);
        if (storages.length > 0) {
          const largest = storages.reduce((max, s) => (s.total > max.total ? s : max), storages[0]);
          imageStorage = largest.storage;
        }
      } catch (err) {
        console.error(`Failed to fetch storages for node ${n.node}:`, err.message);
      }

      return {
        name: n.node,
        ipv4Address,
        apiUrl,
        tokenId,
        secret,
        tlsVerify: tlsVerify === '' || tlsVerify === null ? null : tlsVerify === 'true',
        imageStorage,
        siteId
      };
    }));
    
    const importedNodes = await Node.bulkCreate(nodesWithIp);

    const containerList = await client.clusterResources('lxc');
    const containers = await Promise.all(containerList.map(async (c) => {
      const config = await client.lxcConfig(c.node, c.vmid);
      return {
        hostname: config.hostname,
        username: req.session.user,
        nodeId: importedNodes.find(n => n.name === c.node).id,
        containerId: c.vmid,
        macAddress: config.net0.match(/hwaddr=([0-9A-Fa-f:]+)/)[1],
        ipv4Address: config.net0.match(/ip=([^,]+)/)[1].split('/')[0]
      };
    }));
    await Container.bulkCreate(containers);
    res.redirect(`/sites/${siteId}/nodes`);
  } catch (err) {
    console.log(err);
    req.flash('error', `Failed to import nodes: ${err.message}`);
    return res.redirect(`/sites/${siteId}/nodes/import`);
  }
});

// PUT /sites/:siteId/nodes/:id - Update an existing node
router.put('/:id', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const nodeId = parseInt(req.params.id, 10);
  
  try {
    const site = await Site.findByPk(siteId);
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const node = await Node.findOne({
      where: { id: nodeId, siteId }
    });
    
    if (!node) {
      req.flash('error', 'Node not found');
      return res.redirect(`/sites/${siteId}/nodes`);
    }

    const { name, ipv4Address, apiUrl, tokenId, secret, tlsVerify, imageStorage } = req.body;
    
    const updateData = {
      name,
      ipv4Address: ipv4Address || null,
      apiUrl: apiUrl || null,
      tokenId: tokenId || null,
      tlsVerify: tlsVerify === '' || tlsVerify === null ? null : tlsVerify === 'true',
      imageStorage: imageStorage || 'local'
    };

    // Only update secret if a new value was provided
    if (secret && secret.trim() !== '') {
      updateData.secret = secret;
    }

    await node.update(updateData);

    req.flash('success', `Node ${name} updated successfully`);
    return res.redirect(`/sites/${siteId}/nodes`);
  } catch (err) {
    console.error('Error updating node:', err);
    req.flash('error', `Failed to update node: ${err.message}`);
    return res.redirect(`/sites/${siteId}/nodes/${nodeId}/edit`);
  }
});

// GET /sites/:siteId/nodes/:id/storages - Get storages supporting CT templates
router.get('/:id/storages', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const nodeId = parseInt(req.params.id, 10);

  try {
    const node = await Node.findOne({
      where: { id: nodeId, siteId }
    });

    if (!node || !node.apiUrl || !node.tokenId || !node.secret) {
      return res.json([]);
    }

    const client = await node.api();
    const storages = await client.datastores(node.name, 'vztmpl', true);
    
    return res.json(storages.map(s => ({
      name: s.storage,
      total: s.total,
      available: s.avail
    })));
  } catch (err) {
    console.error('Error fetching storages:', err.message);
    return res.json([]);
  }
});

// DELETE /sites/:siteId/nodes/:id - Delete a node
router.delete('/:id', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const nodeId = parseInt(req.params.id, 10);
  
  try {
    const site = await Site.findByPk(siteId);
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const node = await Node.findOne({
      where: { id: nodeId, siteId },
      include: [{ model: Container, as: 'containers' }]
    });
    
    if (!node) {
      req.flash('error', 'Node not found');
      return res.redirect(`/sites/${siteId}/nodes`);
    }

    // Check if node has containers
    if (node.containers && node.containers.length > 0) {
      req.flash('error', `Cannot delete node ${node.name}: ${node.containers.length} container(s) still reference this node`);
      return res.redirect(`/sites/${siteId}/nodes`);
    }

    await node.destroy();
    
    req.flash('success', `Node ${node.name} deleted successfully`);
    return res.redirect(`/sites/${siteId}/nodes`);
  } catch (err) {
    console.error('Error deleting node:', err);
    req.flash('error', `Failed to delete node: ${err.message}`);
    return res.redirect(`/sites/${siteId}/nodes`);
  }
});

module.exports = router;
