const { Site, Node, Container, Service, HTTPService, TransportService, ExternalDomain } = require('../models');

// Shared query for dnsmasq endpoints
async function loadDnsmasqSite(siteId) {
  return Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        where: { status: 'running' },
        required: false,
        attributes: ['macAddress', 'ipv4Address', 'hostname']
      }]
    }]
  });
}

async function sitesRoutes(fastify, options) {
  const DNSMASQ_TEMPLATES = ['conf', 'dhcp-hosts', 'hosts', 'dhcp-opts', 'servers'];

  // GET /:siteId/dnsmasq/:file - Dnsmasq configuration files (localhost or admin)
  fastify.get('/:siteId/dnsmasq/:file', {
    preHandler: [fastify.requireLocalhostOrAdmin],
    schema: {
      tags: ['Sites'],
      summary: 'Get dnsmasq configuration',
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' },
          file: { type: 'string', enum: DNSMASQ_TEMPLATES }
        },
        required: ['siteId', 'file']
      }
    }
  }, async (request, reply) => {
    const { file } = request.params;
    if (!DNSMASQ_TEMPLATES.includes(file)) {
      return reply.code(404).send('Not found');
    }

    const site = await loadDnsmasqSite(parseInt(request.params.siteId, 10));
    if (!site) {
      return reply.code(404).send('Site not found');
    }

    reply.header('Content-Type', 'text/plain');
    return reply.view(`dnsmasq/${file}`, { site });
  });

  // GET /:siteId/nginx - Endpoint for nginx configuration
  fastify.get('/:siteId/nginx', {
    preHandler: [fastify.requireLocalhostOrAdmin],
    schema: {
      tags: ['Sites'],
      summary: 'Get nginx configuration',
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' }
        },
        required: ['siteId']
      }
    }
  }, async (request, reply) => {
    const siteId = parseInt(request.params.siteId, 10);

    const site = await Site.findByPk(siteId, {
      include: [{
        model: Node,
        as: 'nodes',
        include: [{
          model: Container,
          as: 'containers',
          where: { status: 'running' },
          required: false,
          include: [{
            model: Service,
            as: 'services',
            include: [
              { model: HTTPService, as: 'httpService', include: [{ model: ExternalDomain, as: 'externalDomain' }] },
              { model: TransportService, as: 'transportService' }
            ]
          }]
        }]
      }, {
        model: ExternalDomain,
        as: 'externalDomains'
      }]
    });

    // Flatten services
    const allServices = [];
    site?.nodes?.forEach(node => {
      node?.containers?.forEach(container => {
        container?.services?.forEach(service => {
          service.Container = container;
          allServices.push(service);
        });
      });
    });

    const httpServices = allServices.filter(s => s.type === 'http');
    const streamServices = allServices.filter(s => s.type === 'transport');

    const usedDomainIds = new Set();
    httpServices.forEach(s => {
      if (s.httpService?.externalDomain?.id) usedDomainIds.add(s.httpService.externalDomain.id);
    });
    (site?.externalDomains || []).forEach(d => usedDomainIds.add(d.id));
    const externalDomains = await ExternalDomain.findAll({ where: { id: [...usedDomainIds] } });

    reply.header('Content-Type', 'text/plain');
    return reply.view('nginx-conf', { httpServices, streamServices, externalDomains });
  });

  // Apply auth to all routes below this point
  fastify.addHook('preHandler', fastify.requireAuth);

  // Register nested routers
  fastify.register(require('./nodes'), { prefix: '/:siteId/nodes' });
  fastify.register(require('./containers'), { prefix: '/:siteId/containers' });

  // GET / - List all sites
  fastify.get('/', {
    schema: {
      tags: ['Sites'],
      summary: 'List all sites',
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            sites: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' },
                  internalDomain: { type: 'string' },
                  dhcpRange: { type: 'string' },
                  gateway: { type: 'string' },
                  nodeCount: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const sites = await Site.findAll({
      include: [{ model: Node, as: 'nodes', attributes: ['id', 'name'] }],
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

    if (request.isApiRequest()) {
      return { sites: rows };
    }

    return reply.view('sites/index', { rows, req: request });
  });

  // GET /new - Display form for creating a new site (admin only)
  fastify.get('/new', {
    preHandler: [fastify.requireAdmin]
  }, async (request, reply) => {
    return reply.view('sites/form', {
      site: null,
      isEdit: false,
      req: request
    });
  });

  // GET /:id/edit - Display form for editing a site (admin only)
  fastify.get('/:id/edit', {
    preHandler: [fastify.requireAdmin],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' }
        },
        required: ['id']
      }
    }
  }, async (request, reply) => {
    const site = await Site.findByPk(request.params.id);

    if (!site) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'Site not found' });
      }
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    return reply.view('sites/form', {
      site,
      isEdit: true,
      req: request
    });
  });

  // POST / - Create a new site (admin only)
  fastify.post('/', {
    preHandler: [fastify.requireAdmin],
    schema: {
      tags: ['Sites'],
      summary: 'Create a new site',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          internalDomain: { type: 'string' },
          dhcpRange: { type: 'string' },
          subnetMask: { type: 'string' },
          gateway: { type: 'string' },
          dnsForwarders: { type: 'string' },
          externalIp: { type: 'string' }
        },
        required: ['name']
      }
    }
  }, async (request, reply) => {
    try {
      const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders, externalIp } = request.body;

      const site = await Site.create({
        name,
        internalDomain,
        dhcpRange,
        subnetMask,
        gateway,
        dnsForwarders,
        externalIp: externalIp || null
      });

      if (request.isApiRequest()) {
        return reply.code(201).send({ success: true, site: { id: site.id, name: site.name } });
      }

      request.flash('success', `Site ${name} created successfully`);
      return reply.redirect('/sites');
    } catch (error) {
      fastify.log.error('Error creating site:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to create site: ' + error.message });
      }
      request.flash('error', 'Failed to create site: ' + error.message);
      return reply.redirect('/sites/new');
    }
  });

  // PUT /:id - Update a site (admin only)
  fastify.put('/:id', {
    preHandler: [fastify.requireAdmin],
    schema: {
      tags: ['Sites'],
      summary: 'Update a site',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' }
        },
        required: ['id']
      }
    }
  }, async (request, reply) => {
    try {
      const site = await Site.findByPk(request.params.id);

      if (!site) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Site not found' });
        }
        request.flash('error', 'Site not found');
        return reply.redirect('/sites');
      }

      const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders, externalIp } = request.body;

      await site.update({
        name,
        internalDomain,
        dhcpRange,
        subnetMask,
        gateway,
        dnsForwarders,
        externalIp: externalIp || null
      });

      if (request.isApiRequest()) {
        return { success: true, message: `Site ${name} updated successfully` };
      }

      request.flash('success', `Site ${name} updated successfully`);
      return reply.redirect('/sites');
    } catch (error) {
      fastify.log.error('Error updating site:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to update site: ' + error.message });
      }
      request.flash('error', 'Failed to update site: ' + error.message);
      return reply.redirect(`/sites/${request.params.id}/edit`);
    }
  });

  // DELETE /:id - Delete a site (admin only)
  fastify.delete('/:id', {
    preHandler: [fastify.requireAdmin],
    schema: {
      tags: ['Sites'],
      summary: 'Delete a site',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' }
        },
        required: ['id']
      }
    }
  }, async (request, reply) => {
    try {
      const site = await Site.findByPk(request.params.id, {
        include: [{ model: Node, as: 'nodes' }]
      });

      if (!site) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Site not found' });
        }
        request.flash('error', 'Site not found');
        return reply.redirect('/sites');
      }

      if (site.nodes && site.nodes.length > 0) {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: 'Cannot delete site with associated nodes' });
        }
        request.flash('error', 'Cannot delete site with associated nodes');
        return reply.redirect('/sites');
      }

      const siteName = site.name;
      await site.destroy();

      if (request.isApiRequest()) {
        return reply.code(204).send();
      }

      request.flash('success', `Site ${siteName} deleted successfully`);
      return reply.redirect('/sites');
    } catch (error) {
      fastify.log.error('Error deleting site:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Failed to delete site: ' + error.message });
      }
      request.flash('error', 'Failed to delete site: ' + error.message);
      return reply.redirect('/sites');
    }
  });
}

module.exports = sitesRoutes;
