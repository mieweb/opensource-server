const express = require('express');
const router = express.Router({ mergeParams: true }); // Enable access to :siteId param
const https = require('https');
const dns = require('dns').promises;
const { Container, Service, HTTPService, TransportService, DnsService, Node, Site, ExternalDomain, Job, Sequelize, sequelize } = require('../models');
const { requireAuth } = require('../middlewares');
const ProxmoxApi = require('../utils/proxmox-api');
const serviceMap = require('../data/services.json');
const { isApiRequest } = require('../utils/http');
const { parseDockerRef, getImageConfig, extractImageMetadata } = require('../utils/docker-registry');

/**
 * Normalize a Docker image reference to full format: host/org/image:tag
 */
function normalizeDockerRef(ref) {
  // If this looks like a git URL (starts with http/https/git), return as is
  if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('git@')) {
    return ref;
  }

  let tag = 'latest';
  let imagePart = ref;
  
  const lastColon = ref.lastIndexOf(':');
  if (lastColon !== -1) {
    const potentialTag = ref.substring(lastColon + 1);
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
    image = parts[0];
  } else if (parts.length === 2) {
    if (parts[0].includes('.') || parts[0].includes(':')) {
      host = parts[0];
      image = parts[1];
    } else {
      org = parts[0];
      image = parts[1];
    }
  } else {
    host = parts[0];
    image = parts[parts.length - 1];
    org = parts.slice(1, -1).join('/');
  }
  
  return `${host}/${org}/${image}:${tag}`;
}

// GET /sites/:siteId/containers/metadata - Fetch Docker image metadata
router.get('/metadata', requireAuth, async (req, res) => {
  try {
    const { image } = req.query;
    
    if (!image || !image.trim()) {
      return res.status(400).json({ error: 'Image parameter is required' });
    }
    
    // Normalize the image reference
    const normalizedImage = normalizeDockerRef(image.trim());
    
    // Parse into components
    const parsed = parseDockerRef(normalizedImage);
    const repo = `${parsed.namespace}/${parsed.image}`;
    
    // Fetch image config from registry
    const config = await getImageConfig(parsed.registry, repo, parsed.tag);
    
    // Extract metadata
    const metadata = extractImageMetadata(config);
    
    return res.json(metadata);
  } catch (err) {
    console.error('Error fetching image metadata:', err);
    
    let errorMessage = 'Failed to fetch image metadata';
    if (err.message.includes('HTTP 404')) {
      errorMessage = 'Image not found in registry';
    } else if (err.message.includes('timeout')) {
      errorMessage = 'Request timed out. Registry may be unavailable.';
    } else if (err.message.includes('auth')) {
      errorMessage = 'Authentication failed. Image may be private.';
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      details: err.message 
    });
  }
});

// GET /sites/:siteId/containers/new - List available templates via API or HTML form
router.get('/new', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const isApi = isApiRequest(req); 

  // verify site exists
  const site = await Site.findByPk(siteId);
  if (!site) {
    if (isApi) return res.status(404).json({ error: 'Site not found' });
    await req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }
  
  // Get external domains for this site
  const externalDomains = await ExternalDomain.findAll({
    where: { siteId },
    order: [['name', 'ASC']]
  });

  if (isApi) {
    return res.json({
      site_id: site.id,
      domains: externalDomains
    });
  }
  // ----------------------------

  return res.render('containers/form', { 
    site,
    externalDomains,
    container: undefined, 
    req 
  });
});

// GET /sites/:siteId/containers
// Added requireAuth to ensure API keys and Sessions are validated
router.get('/', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const site = await Site.findByPk(siteId);
  
  // Unified Error Handling for Site 404
  if (!site) {
    if (isApiRequest(req)) {
      return res.status(404).json({ error: 'Site not found' });
    } else {
      await req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }
  }

  const nodes = await Node.findAll({ where: { siteId }, attributes: ['id'] });
  const nodeIds = nodes.map(n => n.id);

  const { hostname } = req.query;
  const where = { 
    username: req.session.user,
    nodeId: nodeIds
  };
  if (hostname) where.hostname = hostname;

  const containers = await Container.findAll({
    where,
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

  const rows = containers.map(c => {
    const services = c.services || [];
    const ssh = services.find(s => s.type === 'transport' && s.transportService?.protocol === 'tcp' && Number(s.internalPort) === 22);
    const sshPort = ssh?.transportService?.externalPort || null;
    const http = services.find(s => s.type === 'http');
    const httpPort = http ? http.internalPort : null;
    
    // Common object structure for both API and View
    return {
      id: c.id,
      hostname: c.hostname,
      ipv4Address: c.ipv4Address,
      // API might want raw MacAddress, View might not need it, but including it doesn't hurt
      macAddress: c.macAddress, 
      status: c.status,
      template: c.template,
      creationJobId: c.creationJobId,
      sshPort,
      httpPort,
      nodeName: c.node ? c.node.name : '-',
      createdAt: c.createdAt
    };
  });

  if (isApiRequest(req)) {
    return res.json({ containers: rows });
  } else {
    return res.render('containers/index', { rows, site, req });
  }
});

// GET /sites/:siteId/containers/:id/edit
router.get('/:id/edit', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    await req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const container = await Container.findOne({
    where: { id: containerId, username: req.session.user },
    include: [
      { model: Node, as: 'node', where: { siteId } },
      {
        model: Service,
        as: 'services',
        include: [
          { model: HTTPService, as: 'httpService', include: [{ model: ExternalDomain, as: 'externalDomain' }] },
          { model: TransportService, as: 'transportService' },
          { model: DnsService, as: 'dnsService' }
        ]
      }
    ]
  });

  if (!container) {
    await req.flash('error', 'Container not found');
    return res.redirect(`/sites/${siteId}/containers`);
  }

  const externalDomains = await ExternalDomain.findAll({ where: { siteId }, order: [['name', 'ASC']] });

  return res.render('containers/form', { 
    site,
    container,
    externalDomains,
    templates: [],
    isEdit: true,
    req 
  });
});

// POST /sites/:siteId/containers
router.post('/', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const isApi = isApiRequest(req);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    if (isApi) return res.status(404).json({ error: 'Site not found' });
    await req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const t = await sequelize.transaction();
  
  try {
    let { hostname, template, customTemplate, services, environmentVars, entrypoint, 
          // Extract specific API fields
          template_name, repository, branch 
        } = req.body;

    // --- API Payload Mapping ---
    if (isApi) {
      if (repository) {
        // Source Build Scenario:
        // We do NOT set template='custom'. We must use the base template_name provided.
        // The repository is passed ONLY via environment variables.

        if (template_name) {
             template = template_name;
             // We deliberately leave 'customTemplate' undefined so it triggers the standard LXC lookup logic below.
        } else {
             throw new Error('When providing a repository, you must also provide a template_name (e.g., "debian-template") for the base container.');
        }

        // Inject repo/branch into env vars
        if (!environmentVars) environmentVars = [];
        // Ensure environmentVars is an array if it came in as something else
        if (!Array.isArray(environmentVars)) environmentVars = [];
        
        environmentVars.push({ key: 'BUILD_REPOSITORY', value: repository });
        environmentVars.push({ key: 'BUILD_BRANCH', value: branch || 'master' });
        
      } else if (template_name && !template) {
        // Fallback: if only template_name provided (no repo), assume it's the template
        template = template_name;
      }
    }
    // ---------------------------
    
    const currentUser = req.session?.user || req.user?.username || 'api-user';

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
    
    // LOGIC: Custom (Docker) vs Standard (LXC)
    if (template === 'custom' || (!template && customTemplate)) {
      // Custom Docker image
      if (!customTemplate || customTemplate.trim() === '') {
        throw new Error('Custom template image is required');
      }
      
      templateName = normalizeDockerRef(customTemplate.trim());
      
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
      // Standard Proxmox template (LXC)
      let templateVmid;

      if (template && template.includes(',')) {
        // Form submitted "nodeName,vmid"
        const [ nodeNamePart, vmidPart ] = template.split(',');
        nodeName = nodeNamePart;
        templateVmid = vmidPart;
      } else {
         // API submitted just the name "debian-template"
         // Find a node that has this template
         const allNodes = await Node.findAll({ 
           where: { siteId },
           // Filter for nodes that are actually online/configured
           attributes: ['id', 'name', 'apiUrl', 'tokenId', 'secret'] 
         });
         
         let foundTemplate = null;
         
         for (const n of allNodes) {
             // Skip nodes without config
             if (!n.apiUrl || !n.tokenId) continue;
             
             try {
               const api = await n.api();
               const tpls = await api.getLxcTemplates(n.name);
               // Match by name or stringified vmid
               const found = tpls.find(t => t.name === template || t.vmid.toString() === template);
               if (found) {
                   node = n;
                   nodeName = n.name;
                   templateVmid = found.vmid;
                   foundTemplate = found;
                   break;
               }
             } catch (e) {
               console.warn(`Failed to query templates from node ${n.name}:`, e.message);
               continue;
             }
         }
         
         if (!node) throw new Error(`Template "${template}" not found on any node in this site`);
         templateName = foundTemplate.name; // Use the real name from Proxmox
      }

      // If we found the node via "nodeName,vmid" logic but haven't fetched details yet
      if (!templateName) {
          node = await Node.findOne({ where: { name: nodeName, siteId } });
          if (!node) throw new Error(`Node "${nodeName}" not found`);
          
          const client = await node.api();
          const templates = await client.getLxcTemplates(node.name);
          const templateContainer = templates.find(t => t.vmid === parseInt(templateVmid, 10));
          
          if (!templateContainer) {
            throw new Error(`Template with VMID ${templateVmid} not found on node ${nodeName}`);
          }
          templateName = templateContainer.name;
      }
    }
    
    // Create container record
    const container = await Container.create({
      hostname,
      username: currentUser,
      status: 'pending',
      template: templateName, // Should now be "debian-12-standard..." or similar
      nodeId: node.id,
      containerId: null,
      macAddress: null,
      ipv4Address: null,
      environmentVars: envVarsJson,
      entrypoint: entrypoint && entrypoint.trim() ? entrypoint.trim() : null
    }, { transaction: t });

    // Services creation
    if (services && typeof services === 'object') {
      for (const key in services) {
        const service = services[key];
        const { type, internalPort, externalHostname, externalDomainId, dnsName } = service;
        
        if (!type || !internalPort) continue;
        
        let serviceType;
        let protocol = null;
        
        if (type === 'http') {
          serviceType = 'http';
        } else if (type === 'srv') {
          serviceType = 'dns';
        } else {
          serviceType = 'transport';
          protocol = type;
        }
        
        const serviceData = {
          containerId: container.id,
          type: serviceType,
          internalPort: parseInt(internalPort, 10)
        };

        const createdService = await Service.create(serviceData, { transaction: t });

        if (serviceType === 'http') {
          if (!externalHostname || !externalDomainId) {
            throw new Error('HTTP services must have both an external hostname and external domain');
          }
          await HTTPService.create({
            serviceId: createdService.id,
            externalHostname,
            externalDomainId: parseInt(externalDomainId, 10)
          }, { transaction: t });
        } else if (serviceType === 'dns') {
          if (!dnsName) throw new Error('DNS services must have a DNS name');
          await DnsService.create({
            serviceId: createdService.id,
            recordType: 'SRV',
            dnsName
          }, { transaction: t });
        } else {
          const minPort = 2000;
          const maxPort = 65565;
          const externalPort = await TransportService.nextAvailablePortInRange(protocol, minPort, maxPort, t);
          await TransportService.create({
            serviceId: createdService.id,
            protocol: protocol,
            externalPort
          }, { transaction: t });
        }
      }
    }

    // Create job
    const job = await Job.create({
      command: `node bin/create-container.js --container-id=${container.id}`,
      createdBy: currentUser,
      status: 'pending'
    }, { transaction: t });

    await container.update({ creationJobId: job.id }, { transaction: t });
    await t.commit();

    if (isApi) {
        return res.status(202).json({
            message: 'Container creation initiated',
            status: 'pending',
            jobId: job.id,
            container: {
                id: container.id,
                hostname: container.hostname,
                status: 'pending'
            }
        });
    }

    await req.flash('success', `Container "${hostname}" is being created.`);
    return res.redirect(`/jobs/${job.id}`);
  } catch (err) {
    await t.rollback();
    console.error('Error creating container:', err);
    
    let errorMessage = 'Failed to create container: ';
    if (err.response?.data?.message) {
        errorMessage += err.response.data.message;
    } else {
        errorMessage += err.message;
    }
    
    if (isApi) {
        return res.status(400).json({ error: errorMessage, details: err.message });
    }

    await req.flash('error', errorMessage);
    return res.redirect(`/sites/${siteId}/containers/new`);
  }
});

// PUT /sites/:siteId/containers/:id
router.put('/:id', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);
  
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
      console.error('API PUT Error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  const site = await Site.findByPk(siteId);
  if (!site) return res.redirect('/sites');

  try {
    const container = await Container.findOne({
      where: { id: containerId, username: req.session.user },
      include: [{ model: Node, as: 'node', where: { siteId } }]
    });

    if (!container) {
      await req.flash('error', 'Container not found');
      return res.redirect(`/sites/${siteId}/containers`);
    }

    const { services, environmentVars, entrypoint } = req.body;
    const forceRestart = req.body.restart === 'true';
    const isRestartOnly = forceRestart && !services && !environmentVars && entrypoint === undefined;

    let envVarsJson = container.environmentVars;
    if (!isRestartOnly && environmentVars && Array.isArray(environmentVars)) {
      const envObj = {};
      for (const env of environmentVars) {
        if (env.key) envObj[env.key.trim()] = env.value || '';
      }
      envVarsJson = Object.keys(envObj).length > 0 ? JSON.stringify(envObj) : null;
    } else if (!isRestartOnly && !environmentVars) {
      envVarsJson = null;
    }
    
    const newEntrypoint = isRestartOnly ? container.entrypoint : 
      (entrypoint && entrypoint.trim() ? entrypoint.trim() : null);
    
    const envChanged = !isRestartOnly && container.environmentVars !== envVarsJson;
    const entrypointChanged = !isRestartOnly && container.entrypoint !== newEntrypoint;
    const needsRestart = forceRestart || envChanged || entrypointChanged;

    let restartJob = null;
    await sequelize.transaction(async (t) => {
      if (envChanged || entrypointChanged) {
        await container.update({
          environmentVars: envVarsJson,
          entrypoint: newEntrypoint,
          status: needsRestart && container.containerId ? 'restarting' : container.status
        }, { transaction: t });
      } else if (forceRestart && container.containerId) {
        await container.update({ status: 'restarting' }, { transaction: t });
      }
      
      if (needsRestart && container.containerId) {
        restartJob = await Job.create({
          command: `node bin/reconfigure-container.js --container-id=${container.id}`,
          createdBy: req.session.user,
          status: 'pending'
        }, { transaction: t });
      }
      
      if (services && typeof services === 'object') {
        // Delete services marked for deletion
        for (const key in services) {
          const { id, deleted } = services[key];
          if (deleted === 'true' && id) {
            await Service.destroy({ 
              where: { id: parseInt(id, 10), containerId: container.id },
              transaction: t
            });
          }
        }
        // Create new services
        for (const key in services) {
          const { id, deleted, type, internalPort, externalHostname, externalDomainId, dnsName } = services[key];
          if (deleted === 'true' || id || !type || !internalPort) continue;
          
          let serviceType = type === 'srv' ? 'dns' : (type === 'http' ? 'http' : 'transport');
          const protocol = (serviceType === 'transport') ? type : null;

          const createdService = await Service.create({
             containerId: container.id,
             type: serviceType,
             internalPort: parseInt(internalPort, 10)
          }, { transaction: t });

          if (serviceType === 'http') {
             await HTTPService.create({ serviceId: createdService.id, externalHostname, externalDomainId }, { transaction: t });
          } else if (serviceType === 'dns') {
             await DnsService.create({ serviceId: createdService.id, recordType: 'SRV', dnsName }, { transaction: t });
          } else {
             const externalPort = await TransportService.nextAvailablePortInRange(protocol, 2000, 65565);
             await TransportService.create({ serviceId: createdService.id, protocol, externalPort }, { transaction: t });
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

// DELETE /sites/:siteId/containers/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const containerId = parseInt(req.params.id, 10);

  if (isApiRequest(req)) {
    try {
      const container = await Container.findByPk(containerId);
      if (!container) return res.status(404).json({ error: 'Not found' });
      await container.destroy(); // Triggers hooks/cascades
      return res.status(204).send();
    } catch (err) {
      console.error('API DELETE Error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  const site = await Site.findByPk(siteId);
  if (!site) return res.redirect('/sites');
  
  const container = await Container.findOne({
    where: { id: containerId, username: req.session.user },
    include: [{ model: Node, as: 'node' }]
  });
  
  if (!container || !container.node || container.node.siteId !== siteId) {
    await req.flash('error', 'Container not found or access denied');
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  const node = container.node;
  try {
    if (container.containerId && node.apiUrl && node.tokenId) {
      const api = await node.api();
      try {
        const config = await api.lxcConfig(node.name, container.containerId);
        if (config.hostname && config.hostname !== container.hostname) {
           await req.flash('error', `Hostname mismatch (DB: ${container.hostname} vs Proxmox: ${config.hostname}). Delete aborted.`);
           return res.redirect(`/sites/${siteId}/containers`);
        }
        await api.deleteContainer(node.name, container.containerId, true, true);
      } catch (proxmoxError) {
        console.log(`Proxmox deletion skipped or failed: ${proxmoxError.message}`);
      }
    }
    await container.destroy();
  } catch (error) {
    console.error(error);
    await req.flash('error', `Failed to delete: ${error.message}`);
    return res.redirect(`/sites/${siteId}/containers`);
  }
  
  await req.flash('success', 'Container deleted successfully');
  return res.redirect(`/sites/${siteId}/containers`);
});

module.exports = router;
