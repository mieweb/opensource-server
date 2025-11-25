const express = require('express');
const router = express.Router({ mergeParams: true }); // Enable access to :siteId param
const https = require('https');
const dns = require('dns').promises;
const { Container, Service, Node, Site, ExternalDomain, Sequelize } = require('../models');
const { requireAuth } = require('../middlewares');
const ProxmoxApi = require('../utils/proxmox-api');
const serviceMap = require('../data/services.json');

// GET /sites/:siteId/containers/new - Display form for creating a new container
router.get('/new', requireAuth, async (req, res) => {
  // verify site exists
  const siteId = parseInt(req.params.siteId, 10);
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }
  
  // Get valid container templates from all nodes in this site
  const templates = [];
  const nodes = await Node.findAll({
    where: {
      [Sequelize.Op.and]: {
        siteId,
        apiUrl: { [Sequelize.Op.ne]: null },
        tokenId: { [Sequelize.Op.ne]: null },
        secret: { [Sequelize.Op.ne]: null }
      }
    },
  });

  for (const node of nodes) {
    const client = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
      httpsAgent: new https.Agent({
        rejectUnauthorized: node.tlsVerify !== false
      })
    });

    // Get datastores for this node
    const datastores = await client.datastores(node.name, 'vztmpl', true);

    // Iterate over each datastore and get its contents
    for (const datastore of datastores) {
      const contents = await client.storageContents(node.name, datastore.storage, 'vztmpl');
      
      // Add templates from this storage
      for (const item of contents) {
        templates.push({
          volid: item.volid,
          name: item.volid.split('/').pop(), // Extract filename from volid
          size: item.size,
          node: node.name,
          storage: datastore.storage
        });
      }
    }
  }

  // Get external domains for this site
  const externalDomains = await ExternalDomain.findAll({
    where: { siteId },
    order: [['name', 'ASC']]
  });

  return res.render('containers/form', { 
    site,
    templates,
    externalDomains,
    container: undefined, // Not editing
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

// GET /sites/:siteId/containers/:id/edit - Display form for editing container services
router.get('/:id/edit', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  // Find the container with ownership check
  const container = await Container.findOne({
    where: { 
      id: containerId,
      username: req.session.user
    },
    include: [
      { 
        model: Node, 
        as: 'node',
        where: { siteId }
      },
      {
        model: Service,
        as: 'services',
        include: [{
          model: ExternalDomain,
          as: 'externalDomain'
        }]
      }
    ]
  });

  if (!container) {
    req.flash('error', 'Container not found');
    return res.redirect(`/sites/${siteId}/containers`);
  }

  // Get external domains for this site
  const externalDomains = await ExternalDomain.findAll({
    where: { siteId },
    order: [['name', 'ASC']]
  });

  return res.render('containers/form', { 
    site,
    container,
    externalDomains,
    templates: [], // Not needed for edit
    isEdit: true,
    req 
  });
});

// POST /sites/:siteId/containers - Create a new container
router.post('/', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  // Validate site exists
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  try {
  // clone the template
  const { hostname, template, services } = req.body;
  const [ nodeName, ostemplate ] = template.split(',');
  const node = await Node.findOne({ where: { name: nodeName, siteId } });
  const client = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
    httpsAgent: new https.Agent({
      rejectUnauthorized: node.tlsVerify !== false
    })
  });
  const vmid = await client.nextId();
  const upid = await client.createLxc(node.name, {
    ostemplate,
    vmid,
    cores: 4,
    features: 'nesting=1',  // allow nested containers
    hostname,
    memory: 4096,  // 4GB RAM
    net0: 'name=eth0,ip=dhcp,bridge=vmbr0',
    rootfs: `${ostemplate.split(':')[0]}:50`,  // 50GB root disk on the template's storage
    searchdomain: site.internalDomain,  // use the site's search domain
    swap: 0,
    onboot: 1,  // start the container automatically on node boot
    start: 1,  // start the container immediately after creation
    tags: req.session.user,
    unprivileged: 1 
  });
  
  // wait for the task to complete
  while (true) {
    const status = await client.taskStatus(node.name, upid);
    if (status.status === 'stopped') break;
  }

  // record container information
  const config = await client.lxcConfig(node.name, vmid);
  const macAddress = config['net0'].match(/hwaddr=([0-9A-Fa-f:]+)/)[1];
  const ipv4Address = await (async () => {
    const maxRetries = 10;
    const retryDelay = 3000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const domainName = `${hostname}.${site.internalDomain}`;
        const lookup = await dns.lookup(domainName);
        return lookup.address;
      } catch (err) {
        console.error('DNS lookup failed:', err);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    console.error('DNS lookup failed after maximum retries');
    return null
  })();
  
  const container = await Container.create({
    hostname,
    username: req.session.user,
    nodeId: node.id,
    containerId: vmid,
    macAddress,
    ipv4Address
  });

  // Create services if provided
  if (services && typeof services === 'object') {
    for (const key in services) {
      const service = services[key];
      const { type, internalPort, externalHostname, externalDomainId } = service;
      
      // Validate required fields
      if (!type || !internalPort) continue;
      
      const serviceData = {
        containerId: container.id,
        type,
        internalPort: parseInt(internalPort, 10)
      };

      if (type === 'http') {
        // For HTTP services, set hostname and domain
        if (externalHostname) {
          serviceData.externalHostname = externalHostname;
        }
        if (externalDomainId) {
          serviceData.externalDomainId = parseInt(externalDomainId, 10);
        }
        serviceData.externalPort = null; // HTTP services don't use external ports
      } else {
        // For TCP/UDP services, auto-assign external port
        const minPort = 2000;
        const maxPort = 65565;
        serviceData.externalPort = await Service.nextAvailablePortInRange(type, minPort, maxPort);
      }

      await Service.create(serviceData);
    }
  }

  return res.redirect(`/sites/${siteId}/containers`);
} catch (err) {
  console.log(err);
  console.log(err.response?.data?.errors);
  throw err;
}
});

// PUT /sites/:siteId/containers/:id - Update container services
router.put('/:id', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  try {
    // Find the container with ownership check
    const container = await Container.findOne({
      where: { 
        id: containerId,
        username: req.session.user
      },
      include: [
        { 
          model: Node, 
          as: 'node',
          where: { siteId }
        }
      ]
    });

    if (!container) {
      req.flash('error', 'Container not found');
      return res.redirect(`/sites/${siteId}/containers`);
    }

    const { services } = req.body;

    // Delete all existing services for this container
    await Service.destroy({
      where: { containerId: container.id }
    });

    // Create new services if provided
    if (services && typeof services === 'object') {
      for (const key in services) {
        const service = services[key];
        const { type, internalPort, externalHostname, externalDomainId } = service;
        
        // Validate required fields
        if (!type || !internalPort) continue;
        
        const serviceData = {
          containerId: container.id,
          type,
          internalPort: parseInt(internalPort, 10)
        };

        if (type === 'http') {
          // For HTTP services, set hostname and domain
          if (externalHostname) {
            serviceData.externalHostname = externalHostname;
          }
          if (externalDomainId) {
            serviceData.externalDomainId = parseInt(externalDomainId, 10);
          }
          serviceData.externalPort = null; // HTTP services don't use external ports
        } else {
          // For TCP/UDP services, auto-assign external port
          const minPort = 2000;
          const maxPort = 65565;
          serviceData.externalPort = await Service.nextAvailablePortInRange(type, minPort, maxPort);
        }

        await Service.create(serviceData);
      }
    }

    req.flash('success', 'Container services updated successfully');
    return res.redirect(`/sites/${siteId}/containers`);
  } catch (err) {
    console.error('Error updating container:', err);
    req.flash('error', 'Failed to update container: ' + err.message);
    return res.redirect(`/sites/${siteId}/containers/${containerId}/edit`);
  }
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
