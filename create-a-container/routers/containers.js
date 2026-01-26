const express = require('express');
const router = express.Router({ mergeParams: true }); // Enable access to :siteId param
const https = require('https');
const dns = require('dns').promises;
const { Container, Service, HTTPService, TransportService, DnsService, Node, Site, ExternalDomain, Sequelize, sequelize } = require('../models');
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

  // TODO: use datamodel backed templates instead of querying Proxmox here
  for (const node of nodes) {
    const client = await node.api();

    const lxcTemplates = await client.getLxcTemplates(node.name);
    
    for (const lxc of lxcTemplates) {
      templates.push({
        vmid: lxc.vmid,
        name: lxc.name,
        status: lxc.status,
        node: node.name
      });
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
      { 
        association: 'services',
        include: [
          { association: 'httpService' },
          { association: 'transportService' }
        ]
      },
      { association: 'node', attributes: ['id', 'name'] }
    ]
  });

  // Map containers to view models
  const rows = containers.map(c => {
    const services = c.services || [];
    // sshPort: externalPort of service with type transport, protocol tcp, and internalPort 22
    const ssh = services.find(s => s.type === 'transport' && s.transportService?.protocol === 'tcp' && Number(s.internalPort) === 22);
    const sshPort = ssh?.transportService?.externalPort || null;
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
        include: [
          {
            model: HTTPService,
            as: 'httpService',
            include: [{
              model: ExternalDomain,
              as: 'externalDomain'
            }]
          },
          {
            model: TransportService,
            as: 'transportService'
          },
          {
            model: DnsService,
            as: 'dnsService'
          }
        ]
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

  // TODO: build the container async in a Job
  try {
  const { hostname, template, services } = req.body;
  const [ nodeName, templateVmid ] = template.split(',');
  const node = await Node.findOne({ where: { name: nodeName, siteId } });
  const client = await node.api();
  const vmid = await client.nextId();
  const upid = await client.cloneLxc(node.name, parseInt(templateVmid, 10), vmid, {
    hostname,
    description: `Cloned from template ${templateVmid}`,
    full: 1
  });
  
  // wait for the task to complete
  while (true) {
    const status = await client.taskStatus(node.name, upid);
    if (status.status === 'stopped') break;
  }

  // Configure the cloned container
  await client.updateLxcConfig(node.name, vmid, {
    cores: 4,
    features: 'nesting=1',
    memory: 4096,
    net0: 'name=eth0,ip=dhcp,bridge=vmbr0',
    searchdomain: site.internalDomain,
    swap: 0,
    onboot: 1,
    tags: req.session.user,
  });

  // Start the container
  const startUpid = await client.startLxc(node.name, vmid);
  
  // wait for the start task to complete
  while (true) {
    const status = await client.taskStatus(node.name, startUpid);
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
      const { type, internalPort, externalHostname, externalDomainId, dnsName } = service;
      
      // Validate required fields
      if (!type || !internalPort) continue;
      
      // Determine the service type (http, transport, or dns)
      let serviceType;
      let protocol = null;
      
      if (type === 'http') {
        serviceType = 'http';
      } else if (type === 'srv') {
        serviceType = 'dns';
      } else {
        // tcp or udp
        serviceType = 'transport';
        protocol = type;
      }
      
      const serviceData = {
        containerId: container.id,
        type: serviceType,
        internalPort: parseInt(internalPort, 10)
      };

      // Create the base service
      const createdService = await Service.create(serviceData);

      if (serviceType === 'http') {
        // Validate that both hostname and domain are set
        if (!externalHostname || !externalDomainId || externalDomainId === '') {
          req.flash('error', 'HTTP services must have both an external hostname and external domain');
          return res.redirect(`/sites/${siteId}/containers/new`);
        }
        
        // Create HTTPService entry
        await HTTPService.create({
          serviceId: createdService.id,
          externalHostname,
          externalDomainId: parseInt(externalDomainId, 10)
        });
      } else if (serviceType === 'dns') {
        // Validate DNS name is set
        if (!dnsName) {
          req.flash('error', 'DNS services must have a DNS name');
          return res.redirect(`/sites/${siteId}/containers/new`);
        }
        
        // Create DnsService entry
        await DnsService.create({
          serviceId: createdService.id,
          recordType: 'SRV',
          dnsName
        });
      } else {
        // For TCP/UDP services, auto-assign external port
        const minPort = 2000;
        const maxPort = 65565;
        const externalPort = await TransportService.nextAvailablePortInRange(protocol, minPort, maxPort);
        
        // Create TransportService entry
        await TransportService.create({
          serviceId: createdService.id,
          protocol: protocol,
          externalPort
        });
      }
    }
  }

  return res.redirect(`/sites/${siteId}/containers`);
} catch (err) {
  console.error('Error creating container:', err);
  
  // Handle axios errors with detailed messages
  let errorMessage = 'Failed to create container: ';
  if (err.response?.data) {
    if (err.response.data.errors) {
      errorMessage += JSON.stringify(err.response.data.errors);
    } else if (err.response.data.message) {
      errorMessage += err.response.data.message;
    } else {
      errorMessage += err.message;
    }
  } else {
    errorMessage += err.message;
  }
  
  req.flash('error', errorMessage);
  return res.redirect(`/sites/${siteId}/containers/new`);
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

    // Wrap all database operations in a transaction
    await sequelize.transaction(async (t) => {
      // Process services in two phases: delete first, then create new
      if (services && typeof services === 'object') {
        // Phase 1: Delete marked services
        for (const key in services) {
          const service = services[key];
          const { id, deleted } = service;
          
          if (deleted === 'true' && id) {
            await Service.destroy({ 
              where: { id: parseInt(id, 10), containerId: container.id },
              transaction: t
            });
          }
        }

        // Phase 2: Create new services (those without an id or not marked as deleted)
        for (const key in services) {
          const service = services[key];
          const { id, deleted, type, internalPort, externalHostname, externalDomainId, dnsName } = service;
          
          // Skip if marked as deleted or if it's an existing service (has id)
          if (deleted === 'true' || id) continue;
          
          // Validate required fields
          if (!type || !internalPort) continue;
          
          // Determine the service type (http, transport, or dns)
          let serviceType;
          let protocol = null;
          
          if (type === 'http') {
            serviceType = 'http';
          } else if (type === 'srv') {
            serviceType = 'dns';
          } else {
            // tcp or udp
            serviceType = 'transport';
            protocol = type;
          }
          
          const serviceData = {
            containerId: container.id,
            type: serviceType,
            internalPort: parseInt(internalPort, 10)
          };

          // Create new service
          const createdService = await Service.create(serviceData, { transaction: t });

          if (serviceType === 'http') {
            // Validate that both hostname and domain are set
            if (!externalHostname || !externalDomainId || externalDomainId === '') {
              throw new Error('HTTP services must have both an external hostname and external domain');
            }
            
            // Create HTTPService entry
            await HTTPService.create({
              serviceId: createdService.id,
              externalHostname,
              externalDomainId: parseInt(externalDomainId, 10)
            }, { transaction: t });
          } else if (serviceType === 'dns') {
            // Validate DNS name is set
            if (!dnsName) {
              throw new Error('DNS services must have a DNS name');
            }
            
            // Create DnsService entry
            await DnsService.create({
              serviceId: createdService.id,
              recordType: 'SRV',
              dnsName
            }, { transaction: t });
          } else {
            // For TCP/UDP services, auto-assign external port
            const minPort = 2000;
            const maxPort = 65565;
            const externalPort = await TransportService.nextAvailablePortInRange(protocol, minPort, maxPort);
            
            // Create TransportService entry
            await TransportService.create({
              serviceId: createdService.id,
              protocol: protocol,
              externalPort
            }, { transaction: t });
          }
        }
      }
    });

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
    const api = await node.api();

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
