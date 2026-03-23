const { Container, Service, HTTPService, TransportService, DnsService, Node, Site, ExternalDomain, Job, Sequelize, sequelize } = require('../models');
const { parseDockerRef, getImageConfig, extractImageMetadata } = require('../utils/docker-registry');
const { manageDnsRecords } = require('../utils/cloudflare-dns');
const { isValidHostname } = require('../utils');

/**
 * Normalize a Docker image reference to full format: host/org/image:tag
 */
function normalizeDockerRef(ref) {
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

async function containersRoutes(fastify, options) {
  // Helper to get siteId from parent route
  function getSiteId(request) {
    return parseInt(request.params.siteId, 10);
  }

  // GET /metadata - Fetch Docker image metadata
  fastify.get('/metadata', {
    preHandler: [fastify.requireAuth],
    schema: {
      tags: ['Containers'],
      summary: 'Fetch Docker image metadata',
      security: [{ BearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          image: { type: 'string' }
        },
        required: ['image']
      }
    }
  }, async (request, reply) => {
    try {
      const { image } = request.query;

      if (!image || !image.trim()) {
        return reply.code(400).send({ error: 'Image parameter is required' });
      }

      const normalizedImage = normalizeDockerRef(image.trim());
      const parsed = parseDockerRef(normalizedImage);
      const repo = `${parsed.namespace}/${parsed.image}`;
      const config = await getImageConfig(parsed.registry, repo, parsed.tag);
      const metadata = extractImageMetadata(config);

      return metadata;
    } catch (err) {
      fastify.log.error('Error fetching image metadata:', err);

      let errorMessage = 'Failed to fetch image metadata';
      if (err.message.includes('HTTP 404')) {
        errorMessage = 'Image not found in registry';
      } else if (err.message.includes('timeout')) {
        errorMessage = 'Request timed out. Registry may be unavailable.';
      } else if (err.message.includes('auth')) {
        errorMessage = 'Authentication failed. Image may be private.';
      }

      return reply.code(500).send({ error: errorMessage, details: err.message });
    }
  });

  // GET /new - List available templates via API or HTML form
  fastify.get('/new', {
    preHandler: [fastify.requireAuth],
    schema: {
      tags: ['Containers'],
      summary: 'Container creation form / template list',
      security: [{ BearerAuth: [] }]
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);

    const site = await Site.findByPk(siteId);
    if (!site) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'Site not found' });
      }
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    const externalDomains = await ExternalDomain.findAll({ order: [['name', 'ASC']] });

    if (request.isApiRequest()) {
      return { site_id: site.id, domains: externalDomains };
    }

    return reply.view('containers/form', {
      site,
      externalDomains,
      container: undefined,
      req: request
    });
  });

  // GET / - List containers
  fastify.get('/', {
    preHandler: [fastify.requireAuth],
    schema: {
      tags: ['Containers'],
      summary: 'List containers',
      security: [{ BearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          hostname: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const site = await Site.findByPk(siteId);

    if (!site) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'Site not found' });
      }
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    const nodes = await Node.findAll({ where: { siteId }, attributes: ['id'] });
    const nodeIds = nodes.map(n => n.id);

    const { hostname } = request.query;
    const where = { username: request.session.user, nodeId: nodeIds };
    if (hostname) where.hostname = hostname;

    const containers = await Container.findAll({
      where,
      include: [
        {
          association: 'services',
          include: [
            { association: 'httpService', include: [{ association: 'externalDomain' }] },
            { association: 'transportService' }
          ]
        },
        { association: 'node', attributes: ['id', 'name', 'apiUrl'] }
      ]
    });

    const rows = containers.map(c => {
      const services = c.services || [];
      const ssh = services.find(s => s.type === 'transport' && s.transportService?.protocol === 'tcp' && Number(s.internalPort) === 22);
      const sshPort = ssh?.transportService?.externalPort || null;
      const http = services.find(s => s.type === 'http');
      const httpPort = http ? http.internalPort : null;
      const httpExternalHost = http?.httpService?.externalHostname && http?.httpService?.externalDomain?.name
        ? `${http.httpService.externalHostname}.${http.httpService.externalDomain.name}`
        : null;
      const httpExternalUrl = httpExternalHost ? `https://${httpExternalHost}` : null;

      return {
        id: c.id,
        containerId: c.containerId,
        hostname: c.hostname,
        ipv4Address: c.ipv4Address,
        macAddress: c.macAddress,
        status: c.status,
        template: c.template,
        creationJobId: c.creationJobId,
        sshPort,
        sshHost: httpExternalHost || site.externalIp,
        httpPort,
        httpExternalUrl,
        nodeName: c.node ? c.node.name : '-',
        nodeApiUrl: c.node ? c.node.apiUrl : null,
        createdAt: c.createdAt
      };
    });

    if (request.isApiRequest()) {
      return { containers: rows };
    }

    return reply.view('containers/index', { rows, site, req: request });
  });

  // GET /:id/edit - Edit container form
  fastify.get('/:id/edit', {
    preHandler: [fastify.requireAuth]
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const containerId = parseInt(request.params.id, 10);

    const site = await Site.findByPk(siteId);
    if (!site) {
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    const container = await Container.findOne({
      where: { id: containerId, username: request.session.user },
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
      request.flash('error', 'Container not found');
      return reply.redirect(`/sites/${siteId}/containers`);
    }

    const externalDomains = await ExternalDomain.findAll({ order: [['name', 'ASC']] });

    return reply.view('containers/form', {
      site,
      container,
      externalDomains,
      templates: [],
      isEdit: true,
      req: request
    });
  });

  // POST / - Create a container
  fastify.post('/', {
    preHandler: [fastify.requireAuth],
    schema: {
      tags: ['Containers'],
      summary: 'Create a container',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          hostname: { type: 'string' },
          template: { type: 'string' },
          template_name: { type: 'string' },
          customTemplate: { type: 'string' },
          repository: { type: 'string' },
          branch: { type: 'string' },
          entrypoint: { type: 'string' },
          environmentVars: { type: 'array', items: { type: 'object' } },
          services: { type: 'object' }
        },
        required: ['hostname']
      },
      response: {
        202: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            status: { type: 'string' },
            jobId: { type: 'integer' },
            container: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);

    const site = await Site.findByPk(siteId);
    if (!site) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'Site not found' });
      }
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    const t = await sequelize.transaction();

    try {
      let { hostname, template, customTemplate, services, environmentVars, entrypoint, template_name, repository, branch } = request.body;

      // API Payload Mapping
      if (request.isApiRequest()) {
        if (template_name && !template) {
          template = template_name;
        }

        if (repository) {
          if (!environmentVars) environmentVars = [];
          if (!Array.isArray(environmentVars)) environmentVars = [];
          environmentVars.push({ key: 'BUILD_REPOSITORY', value: repository });
          environmentVars.push({ key: 'BUILD_BRANCH', value: branch || 'master' });
        }
      }

      if (hostname) hostname = hostname.trim().toLowerCase();
      if (!isValidHostname(hostname)) {
        throw new Error('Invalid hostname: must be 1–63 characters, only lowercase letters, digits, and hyphens, and must start and end with a letter or digit');
      }

      const currentUser = request.session?.user || request.user?.username || 'api-user';

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

      const imageRef = (template === 'custom') ? customTemplate?.trim() : template;
      if (!imageRef) {
        throw new Error('A container template is required');
      }
      const templateName = normalizeDockerRef(imageRef);

      const node = await Node.findOne({
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

      const container = await Container.create({
        hostname,
        username: currentUser,
        status: 'pending',
        template: templateName,
        nodeId: node.id,
        siteId,
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

          if (type === 'http' || type === 'https') {
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
              externalDomainId: parseInt(externalDomainId, 10),
              backendProtocol: type === 'https' ? 'https' : 'http'
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

      const job = await Job.create({
        command: `node bin/create-container.js --container-id=${container.id}`,
        createdBy: currentUser,
        status: 'pending'
      }, { transaction: t });

      await container.update({ creationJobId: job.id }, { transaction: t });
      await t.commit();

      if (request.isApiRequest()) {
        return reply.code(202).send({
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

      request.flash('success', `Container "${hostname}" is being created.`);
      return reply.redirect(`/jobs/${job.id}`);
    } catch (err) {
      await t.rollback();
      fastify.log.error('Error creating container:', err);

      let errorMessage = 'Failed to create container: ';
      if (err.response?.data?.message) {
        errorMessage += err.response.data.message;
      } else {
        errorMessage += err.message;
      }

      if (request.isApiRequest()) {
        return reply.code(400).send({ error: errorMessage, details: err.message });
      }

      request.flash('error', errorMessage);
      return reply.redirect(`/sites/${siteId}/containers/new`);
    }
  });

  // PUT /:id - Update a container
  fastify.put('/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      tags: ['Containers'],
      summary: 'Update a container',
      security: [{ BearerAuth: [] }]
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const containerId = parseInt(request.params.id, 10);

    if (request.isApiRequest()) {
      try {
        const container = await Container.findByPk(containerId);
        if (!container) return reply.code(404).send({ error: 'Not found' });
        await container.update({
          ipv4Address: request.body.ipv4Address ?? container.ipv4Address,
          macAddress: request.body.macAddress ?? container.macAddress,
          osRelease: request.body.osRelease ?? container.osRelease
        });
        return { message: 'Updated' };
      } catch (err) {
        fastify.log.error('API PUT Error:', err);
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }

    const site = await Site.findByPk(siteId);
    if (!site) return reply.redirect('/sites');

    try {
      const container = await Container.findOne({
        where: { id: containerId, username: request.session.user },
        include: [{ model: Node, as: 'node', where: { siteId } }]
      });

      if (!container) {
        request.flash('error', 'Container not found');
        return reply.redirect(`/sites/${siteId}/containers`);
      }

      const { services, environmentVars, entrypoint } = request.body;
      const forceRestart = request.body.restart === 'true';
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
      let dnsWarnings = [];
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
            createdBy: request.session.user,
            status: 'pending'
          }, { transaction: t });
        }

        if (services && typeof services === 'object') {
          const deletedHttpServices = [];
          for (const key in services) {
            const { id, deleted } = services[key];
            if (deleted === 'true' && id) {
              const svc = await Service.findByPk(parseInt(id, 10), {
                include: [{ model: HTTPService, as: 'httpService', include: [{ model: ExternalDomain, as: 'externalDomain' }] }],
                transaction: t
              });
              if (svc?.httpService?.externalDomain) {
                deletedHttpServices.push({ externalHostname: svc.httpService.externalHostname, ExternalDomain: svc.httpService.externalDomain });
              }
              await Service.destroy({
                where: { id: parseInt(id, 10), containerId: container.id },
                transaction: t
              });
            }
          }

          const newHttpServices = [];
          for (const key in services) {
            const { id, deleted, type, internalPort, externalHostname, externalDomainId, dnsName } = services[key];
            if (deleted === 'true' || id || !type || !internalPort) continue;

            let serviceType = type === 'srv' ? 'dns' : ((type === 'http' || type === 'https') ? 'http' : 'transport');
            const protocol = (serviceType === 'transport') ? type : null;

            const createdService = await Service.create({
              containerId: container.id,
              type: serviceType,
              internalPort: parseInt(internalPort, 10)
            }, { transaction: t });

            if (serviceType === 'http') {
              await HTTPService.create({ serviceId: createdService.id, externalHostname, externalDomainId, backendProtocol: type === 'https' ? 'https' : 'http' }, { transaction: t });
              const domain = await ExternalDomain.findByPk(parseInt(externalDomainId, 10), { transaction: t });
              if (domain) newHttpServices.push({ externalHostname, ExternalDomain: domain });
            } else if (serviceType === 'dns') {
              await DnsService.create({ serviceId: createdService.id, recordType: 'SRV', dnsName }, { transaction: t });
            } else {
              const externalPort = await TransportService.nextAvailablePortInRange(protocol, 2000, 65565);
              await TransportService.create({ serviceId: createdService.id, protocol, externalPort }, { transaction: t });
            }
          }

          dnsWarnings = [];
          if (deletedHttpServices.length > 0) {
            dnsWarnings.push(...await manageDnsRecords(deletedHttpServices, site, 'delete'));
          }
          if (newHttpServices.length > 0) {
            dnsWarnings.push(...await manageDnsRecords(newHttpServices, site, 'create'));
          }
        }
      });

      if (restartJob) {
        let msg = 'Container configuration updated. Restarting container...';
        for (const w of dnsWarnings) msg += ` ⚠️ ${w}`;
        request.flash('success', msg);
        return reply.redirect(`/jobs/${restartJob.id}`);
      } else {
        let msg = 'Container services updated successfully';
        for (const w of dnsWarnings) msg += ` ⚠️ ${w}`;
        request.flash('success', msg);
      }
      return reply.redirect(`/sites/${siteId}/containers`);
    } catch (err) {
      fastify.log.error('Error updating container:', err);
      request.flash('error', 'Failed to update container: ' + err.message);
      return reply.redirect(`/sites/${siteId}/containers/${containerId}/edit`);
    }
  });

  // DELETE /:id - Delete a container
  fastify.delete('/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      tags: ['Containers'],
      summary: 'Delete a container',
      security: [{ BearerAuth: [] }]
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const containerId = parseInt(request.params.id, 10);

    if (request.isApiRequest()) {
      try {
        const container = await Container.findByPk(containerId);
        if (!container) return reply.code(404).send({ error: 'Not found' });
        await container.destroy();
        return reply.code(204).send();
      } catch (err) {
        fastify.log.error('API DELETE Error:', err);
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }

    const site = await Site.findByPk(siteId);
    if (!site) return reply.redirect('/sites');

    const container = await Container.findOne({
      where: { id: containerId, username: request.session.user },
      include: [
        { model: Node, as: 'node' },
        { model: Service, as: 'services', include: [{ model: HTTPService, as: 'httpService', include: [{ model: ExternalDomain, as: 'externalDomain' }] }] }
      ]
    });

    if (!container || !container.node || container.node.siteId !== siteId) {
      request.flash('error', 'Container not found or access denied');
      return reply.redirect(`/sites/${siteId}/containers`);
    }

    const node = container.node;
    let dnsWarnings = [];
    try {
      const httpServices = (container.services || [])
        .filter(s => s.httpService?.externalDomain)
        .map(s => ({ externalHostname: s.httpService.externalHostname, ExternalDomain: s.httpService.externalDomain }));
      if (httpServices.length > 0) {
        dnsWarnings = await manageDnsRecords(httpServices, site, 'delete');
      }

      if (container.containerId && node.apiUrl && node.tokenId) {
        const api = await node.api();
        try {
          const config = await api.lxcConfig(node.name, container.containerId);
          if (config.hostname && config.hostname !== container.hostname) {
            request.flash('error', `Hostname mismatch (DB: ${container.hostname} vs Proxmox: ${config.hostname}). Delete aborted.`);
            return reply.redirect(`/sites/${siteId}/containers`);
          }
          await api.deleteContainer(node.name, container.containerId, true, true);
        } catch (proxmoxError) {
          fastify.log.info(`Proxmox deletion skipped or failed: ${proxmoxError.message}`);
        }
      }
      await container.destroy();
    } catch (error) {
      fastify.log.error(error);
      request.flash('error', `Failed to delete: ${error.message}`);
      return reply.redirect(`/sites/${siteId}/containers`);
    }

    let msg = 'Container deleted successfully';
    for (const w of dnsWarnings) msg += ` ⚠️ ${w}`;
    request.flash('success', msg);
    return reply.redirect(`/sites/${siteId}/containers`);
  });
}

module.exports = containersRoutes;
