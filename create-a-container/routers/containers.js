const express = require('express');
const router = express.Router({ mergeParams: true }); // Enable access to :siteId param
const https = require('https');
const dns = require('dns').promises;
const { Container, Service, HTTPService, TransportService, DnsService, Node, Site, ExternalDomain, Job, Sequelize, sequelize } = require('../models');
const { requireAuth } = require('../middlewares');
const ProxmoxApi = require('../utils/proxmox-api');
const serviceMap = require('../data/services.json');

/**
 * Normalize a Docker image reference to full format: host/org/image:tag
 * Examples:
 *   nginx              → docker.io/library/nginx:latest
 *   nginx:alpine       → docker.io/library/nginx:alpine
 *   myorg/myapp        → docker.io/myorg/myapp:latest
 *   myorg/myapp:v1     → docker.io/myorg/myapp:v1
 *   ghcr.io/org/app:v1 → ghcr.io/org/app:v1
 */
function normalizeDockerRef(ref) {
  // Split off tag first
  let tag = 'latest';
  let imagePart = ref;
  
  const lastColon = ref.lastIndexOf(':');
  if (lastColon !== -1) {
    const potentialTag = ref.substring(lastColon + 1);
    // Make sure this isn't a port number in a registry URL (e.g., registry:5000/image)
    if (!potentialTag.includes('/')) {
      tag = potentialTag;
      imagePart = ref.substring(0, lastColon);
    }
  }
  
  const parts = imagePart.split('/');
  
  let host = 'docker.io';
  let org = 'library';
  let image;
  
  if (parts.length === 1) {
    // Just image name: nginx
    image = parts[0];
  } else if (parts.length === 2) {
    // Could be org/image or host/image
    // If first part contains a dot or colon, it's a registry host
    if (parts[0].includes('.') || parts[0].includes(':')) {
      host = parts[0];
      image = parts[1];
    } else {
      // org/image
      org = parts[0];
      image = parts[1];
    }
  } else {
    // host/org/image or host/path/to/image
    host = parts[0];
    image = parts[parts.length - 1];
    org = parts.slice(1, -1).join('/');
  }
  
  return `${host}/${org}/${image}:${tag}`;
}

// GET /sites/:siteId/containers/new - Display form for creating a new container
router.get('/new', requireAuth, async (req, res) => {
  // verify site exists
  const siteId = parseInt(req.params.siteId, 10);
  const site = await Site.findByPk(siteId);
  if (!site) {
    await req.flash('error', 'Site not found');
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

// Helper to detect API bearer requests
function isApiRequest(req) {
  const auth = req.get('authorization') || '';
  const parts = auth.split(' ');
  return parts.length === 2 && parts[0] === 'Bearer' && parts[1] === process.env.API_KEY;
}

// GET /sites/:siteId/containers - List all containers for the logged-in user in this site
router.get('/', async (req, res) => {
  // If called by API clients using Bearer token, return JSON instead of HTML
  if (isApiRequest(req)) {
    try {
      const siteId = parseInt(req.params.siteId, 10);
      const site = await Site.findByPk(siteId);
      if (!site) return res.status(404).json([]);

      // Limit search to nodes within this site
      const nodes = await Node.findAll({ where: { siteId }, attributes: ['id'] });
      const nodeIds = nodes.map(n => n.id);

      const { hostname } = req.query;
      const where = {};
      if (hostname) where.hostname = hostname;
      where.nodeId = nodeIds;

      const containers = await Container.findAll({ where, include: [{ association: 'node', attributes: ['id', 'name'] }] });
      const out = containers.map(c => ({ id: c.id, hostname: c.hostname, ipv4Address: c.ipv4Address, macAddress: c.macAddress, node: c.node ? { id: c.node.id, name: c.node.name } : null, createdAt: c.createdAt }));
      return res.json(out);
    } catch (err) {
      console.error('API GET /sites/:siteId/containers error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Browser path: require authentication and render HTML
  await new Promise(resolve => requireAuth(req, res, resolve));
  if (res.headersSent) return; // requireAuth already handled redirect

  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    await req.flash('error', 'Site not found');
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
      status: c.status,
      template: c.template,
      creationJobId: c.creationJobId,
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
    await req.flash('error', 'Site not found');
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
    await req.flash('error', 'Container not found');
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

// POST /sites/:siteId/containers - Create a new container (async via job)
router.post('/', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  // Validate site exists
  const site = await Site.findByPk(siteId);
  if (!site) {
    await req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const t = await sequelize.transaction();
  
  try {
    const { hostname, template, customTemplate, services, environmentVars, entrypoint } = req.body;
    
    // Convert environment variables array to JSON object
    let envVarsJson = null;
    if (environmentVars && Array.isArray(environmentVars)) {
      const envObj = {};
      for (const env of environmentVars) {
        if (env.key && env.key.trim()) {
          envObj[env.key.trim()] = env.value || '';
        }
      }
      if (Object.keys(envObj).length > 0) {
        envVarsJson = JSON.stringify(envObj);
      }
    }
    
    let nodeName, templateName, node;
    
    if (template === 'custom' || !template) {
      // Custom Docker image - parse and normalize the reference
      if (!customTemplate || customTemplate.trim() === '') {
        throw new Error('Custom template image is required');
      }
      
      templateName = normalizeDockerRef(customTemplate.trim());
      
      // For custom templates, pick the first available node in the site
      node = await Node.findOne({ 
        where: { 
          siteId,
          apiUrl: { [Sequelize.Op.ne]: null },
          tokenId: { [Sequelize.Op.ne]: null },
          secret: { [Sequelize.Op.ne]: null }
        } 
      });
      
      if (!node) {
        throw new Error('No nodes with API access available in this site');
      }
    } else {
      // Standard Proxmox template
      const [ nodeNamePart, templateVmid ] = template.split(',');
      nodeName = nodeNamePart;
      node = await Node.findOne({ where: { name: nodeName, siteId } });
      
      if (!node) {
        throw new Error(`Node "${nodeName}" not found`);
      }
      
      // Get the template name from Proxmox
      const client = await node.api();
      const templates = await client.getLxcTemplates(node.name);
      const templateContainer = templates.find(t => t.vmid === parseInt(templateVmid, 10));
      
      if (!templateContainer) {
        throw new Error(`Template with VMID ${templateVmid} not found on node ${nodeName}`);
      }
      
      templateName = templateContainer.name;
    }
    
    // Create the container record in pending status (VMID allocated by job)
    const container = await Container.create({
      hostname,
      username: req.session.user,
      status: 'pending',
      template: templateName,
      nodeId: node.id,
      containerId: null,
      macAddress: null,
      ipv4Address: null,
      environmentVars: envVarsJson,
      entrypoint: entrypoint && entrypoint.trim() ? entrypoint.trim() : null
    }, { transaction: t });

    // Create services if provided (validate within transaction)
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
          const externalPort = await TransportService.nextAvailablePortInRange(protocol, minPort, maxPort, t);
          
          // Create TransportService entry
          await TransportService.create({
            serviceId: createdService.id,
            protocol: protocol,
            externalPort
          }, { transaction: t });
        }
      }
    }

    // Create the job to perform the actual container creation
    const job = await Job.create({
      command: `node bin/create-container.js --container-id=${container.id}`,
      createdBy: req.session.user,
      status: 'pending'
    }, { transaction: t });

    // Link the container to the job
    await container.update({ creationJobId: job.id }, { transaction: t });

    // Commit the transaction
    await t.commit();

    await req.flash('success', `Container "${hostname}" is being created. Check back shortly for status updates.`);
    return res.redirect(`/jobs/${job.id}`);
  } catch (err) {
    // Rollback the transaction
    await t.rollback();
    
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
    
    await req.flash('error', errorMessage);
    return res.redirect(`/sites/${siteId}/containers/new`);
  }
});

// PUT /sites/:siteId/containers/:id - Update container services
router.put('/:id', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);
  // API clients may update container metadata via Bearer token
  if (isApiRequest(req)) {
    try {
      const container = await Container.findByPk(containerId);
      if (!container) return res.status(404).json({ error: 'Not found' });
      await container.update({
        ipv4Address: req.body.ipv4Address ?? container.ipv4Address,
        macAddress: req.body.macAddress ?? container.macAddress,
        osRelease: req.body.osRelease ?? container.osRelease
      });
      return res.status(200).json({ message: 'Updated' });
    } catch (err) {
      console.error('API PUT /sites/:siteId/containers/:id error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    await req.flash('error', 'Site not found');
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
      await req.flash('error', 'Container not found');
      return res.redirect(`/sites/${siteId}/containers`);
    }

    const { services, environmentVars, entrypoint } = req.body;
    
    // Check if this is a restart-only request (no config changes)
    const forceRestart = req.body.restart === 'true';
    const isRestartOnly = forceRestart && !services && !environmentVars && entrypoint === undefined;

    // Convert environment variables array to JSON object
    let envVarsJson = container.environmentVars; // Default to existing
    if (!isRestartOnly && environmentVars && Array.isArray(environmentVars)) {
      const envObj = {};
      for (const env of environmentVars) {
        if (env.key && env.key.trim()) {
          envObj[env.key.trim()] = env.value || '';
        }
      }
      envVarsJson = Object.keys(envObj).length > 0 ? JSON.stringify(envObj) : null;
    } else if (!isRestartOnly && !environmentVars) {
      envVarsJson = null;
    }
    
    const newEntrypoint = isRestartOnly ? container.entrypoint : 
      (entrypoint && entrypoint.trim() ? entrypoint.trim() : null);
    
    // Check if env vars or entrypoint changed
    const envChanged = !isRestartOnly && container.environmentVars !== envVarsJson;
    const entrypointChanged = !isRestartOnly && container.entrypoint !== newEntrypoint;
    const needsRestart = forceRestart || envChanged || entrypointChanged;

    // Wrap all database operations in a transaction
    let restartJob = null;
    await sequelize.transaction(async (t) => {
      // Update environment variables and entrypoint if changed
      if (envChanged || entrypointChanged) {
        await container.update({
          environmentVars: envVarsJson,
          entrypoint: newEntrypoint,
          status: needsRestart && container.containerId ? 'restarting' : container.status
        }, { transaction: t });
      } else if (forceRestart && container.containerId) {
        // Just update status for force restart
        await container.update({ status: 'restarting' }, { transaction: t });
      }
      
      // Create restart job if needed and container has a VMID
      if (needsRestart && container.containerId) {
        restartJob = await Job.create({
          command: `node bin/reconfigure-container.js --container-id=${container.id}`,
          createdBy: req.session.user,
          status: 'pending'
        }, { transaction: t });
      }
      
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

    if (restartJob) {
      await req.flash('success', 'Container configuration updated. Restarting container...');
      return res.redirect(`/jobs/${restartJob.id}`);
    } else {
      await req.flash('success', 'Container services updated successfully');
    }
    return res.redirect(`/sites/${siteId}/containers`);
  } catch (err) {
    console.error('Error updating container:', err);
    await req.flash('error', 'Failed to update container: ' + err.message);
    return res.redirect(`/sites/${siteId}/containers/${containerId}/edit`);
  }
});

// DELETE /sites/:siteId/containers/:id - Delete a container
router.delete('/:id', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);
  // If API request, perform lightweight delete and return JSON/204
  if (isApiRequest(req)) {
    try {
      const container = await Container.findByPk(containerId);
      if (!container) return res.status(404).json({ error: 'Not found' });
      await container.destroy();
      return res.status(204).send();
    } catch (err) {
      console.error('API DELETE /sites/:siteId/containers/:id error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  // Validate site exists
  const site = await Site.findByPk(siteId);
  if (!site) {
    await req.flash('error', 'Site not found');
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
    await req.flash('error', 'Container not found');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  // Verify the container's node belongs to this site
  if (!container.node || container.node.siteId !== siteId) {
    await req.flash('error', 'Container does not belong to this site');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  const node = container.node;
  if (!node.apiUrl) {
    await req.flash('error', 'Node API URL not configured');
    return res.redirect(`/sites/${siteId}/containers`);
  }

  if (!node.tokenId || !node.secret) {
    await req.flash('error', 'Node API token not configured');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  try {
    // Only attempt Proxmox deletion if containerId exists
    if (container.containerId) {
      const api = await node.api();
      
      // Sanity check: verify the container in Proxmox matches our database record
      try {
        const proxmoxConfig = await api.lxcConfig(node.name, container.containerId);
        const proxmoxHostname = proxmoxConfig.hostname;
        
        if (proxmoxHostname && proxmoxHostname !== container.hostname) {
          console.error(`Hostname mismatch: DB has "${container.hostname}", Proxmox has "${proxmoxHostname}" for VMID ${container.containerId}`);
          await req.flash('error', `Safety check failed: Proxmox container hostname "${proxmoxHostname}" does not match database hostname "${container.hostname}". Manual intervention required.`);
          return res.redirect(`/sites/${siteId}/containers`);
        }
        
        // Delete from Proxmox
        await api.deleteContainer(node.name, container.containerId, true, true);
        console.log(`Deleted container ${container.containerId} from Proxmox node ${node.name}`);
      } catch (proxmoxError) {
        // If container doesn't exist in Proxmox (404 or similar), continue with DB deletion
        if (proxmoxError.response?.status === 500 && proxmoxError.response?.data?.errors?.vmid) {
          console.log(`Container ${container.containerId} not found in Proxmox, proceeding with DB deletion`);
        } else if (proxmoxError.response?.status === 404) {
          console.log(`Container ${container.containerId} not found in Proxmox, proceeding with DB deletion`);
        } else {
          throw proxmoxError;
        }
      }
    } else {
      console.log(`Container ${container.hostname} has no containerId, skipping Proxmox deletion`);
    }

    // Delete from database (cascade deletes associated services)
    await container.destroy();
  } catch (error) {
    console.error(error);
    await req.flash('error', `Failed to delete container: ${error.message}`);
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  await req.flash('success', `Container ${container.hostname} deleted successfully`);
  return res.redirect(`/sites/${siteId}/containers`);
});

module.exports = router;
