const express = require('express');
const router = express.Router({ mergeParams: true }); // Enable access to :siteId param
const https = require('https');
const { Container, Service, Node, Site } = require('../models');
const { requireAuth } = require('../middlewares');
const { ProxmoxApi } = require('../utils/proxmox-api');
const serviceMap = require('../data/services.json');

// Helper function to determine node ID based on aiContainer and containerId
async function getNodeForContainer(aiContainer, containerId) {
  let nodeName;
  
  if (aiContainer === 'FORTWAYNE') {
    nodeName = 'intern-phxdc-pve3-ai';
  } else if (aiContainer === 'PHOENIX') {
    nodeName = 'mie-phxdc-ai-pve1';
  } else {
    nodeName = (containerId % 2 === 1) ? 'intern-phxdc-pve1' : 'intern-phxdc-pve2';
  }
  
  const node = await Node.findOne({ where: { name: nodeName } });
  if (!node) {
    throw new Error(`Node not found: ${nodeName}`);
  }
  
  return node.id;
}

// GET /sites/:siteId/containers/new - Display form for creating a new container
router.get('/new', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  return res.render('containers/form', { 
    site,
    req 
  });
});

// GET /sites/:siteId/containers - List all containers for the logged-in user in this site
router.get('/', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  // Find all nodes that belong to this site
  const nodes = await Node.findAll({
    where: { siteId },
    attributes: ['id']
  });
  const nodeIds = nodes.map(n => n.id);

  // Find containers that belong to nodes in this site and belong to the current user
  const containers = await Container.findAll({
    where: { 
      username: req.session.user,
      nodeId: nodeIds
    },
    include: [
      { association: 'services' },
      { association: 'node', attributes: ['id', 'name'] }
    ]
  });

  // Map containers to view models
  const rows = containers.map(c => {
    const services = c.services || [];
    // sshPort: externalPort of service with type tcp and internalPort 22
    const ssh = services.find(s => s.type === 'tcp' && Number(s.internalPort) === 22);
    const sshPort = ssh ? ssh.externalPort : null;
    // httpPort: internalPort of first service type http
    const http = services.find(s => s.type === 'http');
    const httpPort = http ? http.internalPort : null;
    return {
      id: c.id,
      hostname: c.hostname,
      ipv4Address: c.ipv4Address,
      osRelease: c.osRelease,
      sshPort,
      httpPort,
      nodeName: c.node ? c.node.name : '-'
    };
  });

  return res.render('containers/index', { 
    rows,
    site,
    req
  });
});

// POST /sites/:siteId/containers - Create a new container
router.post('/', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const isInit = req.body.init === 'true' || req.body.init === true;
  
  // Validate site exists
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }
  
  // Only require auth for init=true (user-initiated container creation)
  if (isInit) {
    // User-initiated container creation via web form is no longer supported
    // The jobs object has been removed - this endpoint now only handles API calls
    req.flash('error', 'Container creation via web form is no longer supported');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  // handle non-init container creation (e.g., admin API)
  const aiContainer = req.body.aiContainer || 'N';
  const containerId = req.body.containerId;
  const nodeId = await getNodeForContainer(aiContainer, containerId);
  
  // Verify the node belongs to this site
  const node = await Node.findOne({ where: { id: nodeId, siteId } });
  if (!node) {
    return res.status(400).json({ 
      success: false, 
      error: 'Node does not belong to this site' 
    });
  }
  
  const sshPort = await Service.nextAvailablePortInRange('tcp', 2222, 2999);
  
  const container = await Container.create({
    ...req.body,
    nodeId
  });
  const httpService = await Service.create({
    containerId: container.id,
    type: 'http',
    internalPort: req.body.httpPort,
    externalPort: null,
    tls: null,
    externalHostname: container.hostname
  });
  const sshService = await Service.create({
    containerId: container.id,
    type: 'tcp',
    internalPort: 22,
    externalPort: sshPort,
    tls: false,
    externalHostname: null
  });
  const services = [httpService, sshService];
  if (req.body.additionalProtocols) {
    const additionalProtocols = req.body.additionalProtocols.split(',').map(p => p.trim().toLowerCase()); 
    for (const protocol of additionalProtocols) {
      const defaultPort = serviceMap[protocol].port;
      const underlyingProtocol = serviceMap[protocol].protocol;
      const port = await Service.nextAvailablePortInRange(underlyingProtocol, 10001, 29999)
      const additionalService = await Service.create({
        containerId: container.id,
        type: underlyingProtocol,
        internalPort: defaultPort,
        externalPort: port,
        tls: false,
        externalHostname: null
      });
      services.push(additionalService);
    }
  }
  return res.json({ success: true, data: { ...container.toJSON(), services } });
});

// DELETE /sites/:siteId/containers/:id - Delete a container
router.delete('/:id', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);
  
  // Validate site exists
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }
  
  // Find the container with ownership check in query to prevent information leakage
  const container = await Container.findOne({
    where: { 
      id: containerId,
      username: req.session.user
    },
    include: [{ 
      model: Node, 
      as: 'node',
      attributes: ['id', 'name', 'apiUrl', 'tokenId', 'secret', 'tlsVerify', 'siteId']
    }]
  });
  
  if (!container) {
    req.flash('error', 'Container not found');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  // Verify the container's node belongs to this site
  if (!container.node || container.node.siteId !== siteId) {
    req.flash('error', 'Container does not belong to this site');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  const node = container.node;
  if (!node.apiUrl) {
    req.flash('error', 'Node API URL not configured');
    return res.redirect(`/sites/${siteId}/containers`);
  }

  if (!node.tokenId || !node.secret) {
    req.flash('error', 'Node API token not configured');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  // Delete from Proxmox
  try {
    const api = new ProxmoxApi(
      node.apiUrl,
      node.tokenId,
      node.secret,
      {
        httpsAgent: new https.Agent({
          rejectUnauthorized: node.tlsVerify !== false,
        })
      }
    );

    await api.deleteContainer(node.name, container.containerId, true, true);
  } catch (error) {
    console.error(error);
    req.flash('error', `Failed to delete container from Proxmox: ${error.message}`);
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  // Delete from database (cascade deletes associated services)
  await container.destroy();
  
  req.flash('success', `Container ${container.hostname} deleted successfully`);
  return res.redirect(`/sites/${siteId}/containers`);
});

module.exports = router;
