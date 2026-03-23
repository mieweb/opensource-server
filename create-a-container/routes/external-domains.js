const { ExternalDomain, Site } = require('../models');

async function externalDomainsRoutes(fastify, options) {
  // All routes require authentication + admin
  fastify.addHook('preHandler', fastify.requireAuth);
  fastify.addHook('preHandler', fastify.requireAdmin);

  // GET / - List all external domains
  fastify.get('/', {
    schema: {
      tags: ['External Domains'],
      summary: 'List external domains',
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            domains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' },
                  acmeEmail: { type: 'string' },
                  acmeDirectoryUrl: { type: 'string' },
                  cloudflareApiEmail: { type: 'string' },
                  defaultSite: { type: 'string', nullable: true }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const externalDomains = await ExternalDomain.findAll({
      include: [{ model: Site, as: 'site', attributes: ['id', 'name'], required: false }],
      order: [['name', 'ASC']]
    });

    const rows = externalDomains.map(d => ({
      id: d.id,
      name: d.name,
      acmeEmail: d.acmeEmail,
      acmeDirectoryUrl: d.acmeDirectoryUrl,
      cloudflareApiEmail: d.cloudflareApiEmail,
      defaultSite: d.site ? d.site.name : null
    }));

    if (request.isApiRequest()) {
      return { domains: rows };
    }

    return reply.view('external-domains/index', { rows, req: request });
  });

  // GET /new - Display form for creating a new external domain
  fastify.get('/new', async (request, reply) => {
    const sites = await Site.findAll({ order: [['name', 'ASC']] });
    return reply.view('external-domains/form', {
      externalDomain: null,
      sites,
      isEdit: false,
      req: request
    });
  });

  // GET /:id/edit - Display form for editing an external domain
  fastify.get('/:id/edit', {
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
    const domainId = parseInt(request.params.id, 10);
    const externalDomain = await ExternalDomain.findByPk(domainId);

    if (!externalDomain) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'External domain not found' });
      }
      request.flash('error', 'External domain not found');
      return reply.redirect('/external-domains');
    }

    const sites = await Site.findAll({ order: [['name', 'ASC']] });
    return reply.view('external-domains/form', {
      externalDomain,
      sites,
      isEdit: true,
      req: request
    });
  });

  // POST / - Create a new external domain
  fastify.post('/', {
    schema: {
      tags: ['External Domains'],
      summary: 'Create external domain',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          acmeEmail: { type: 'string' },
          acmeDirectoryUrl: { type: 'string' },
          cloudflareApiEmail: { type: 'string' },
          cloudflareApiKey: { type: 'string' },
          siteId: { type: 'integer' }
        },
        required: ['name']
      }
    }
  }, async (request, reply) => {
    try {
      const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId } = request.body;

      const domain = await ExternalDomain.create({
        name,
        acmeEmail: acmeEmail || null,
        acmeDirectoryUrl: acmeDirectoryUrl || null,
        cloudflareApiEmail: cloudflareApiEmail || null,
        cloudflareApiKey: cloudflareApiKey || null,
        siteId: siteId || null
      });

      if (request.isApiRequest()) {
        return reply.code(201).send({ success: true, domain: { id: domain.id, name: domain.name } });
      }

      request.flash('success', `External domain ${name} created successfully`);
      return reply.redirect('/external-domains');
    } catch (error) {
      fastify.log.error('Error creating external domain:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to create external domain: ' + error.message });
      }
      request.flash('error', 'Failed to create external domain: ' + error.message);
      return reply.redirect('/external-domains/new');
    }
  });

  // PUT /:id - Update an external domain
  fastify.put('/:id', {
    schema: {
      tags: ['External Domains'],
      summary: 'Update external domain',
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
    const domainId = parseInt(request.params.id, 10);

    try {
      const externalDomain = await ExternalDomain.findByPk(domainId);

      if (!externalDomain) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'External domain not found' });
        }
        request.flash('error', 'External domain not found');
        return reply.redirect('/external-domains');
      }

      const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId } = request.body;

      const updateData = {
        name,
        acmeEmail: acmeEmail || null,
        acmeDirectoryUrl: acmeDirectoryUrl || null,
        cloudflareApiEmail: cloudflareApiEmail || null,
        siteId: siteId || null
      };

      if (cloudflareApiKey && cloudflareApiKey.trim() !== '') {
        updateData.cloudflareApiKey = cloudflareApiKey;
      }

      await externalDomain.update(updateData);

      if (request.isApiRequest()) {
        return { success: true, message: `External domain ${name} updated successfully` };
      }

      request.flash('success', `External domain ${name} updated successfully`);
      return reply.redirect('/external-domains');
    } catch (error) {
      fastify.log.error('Error updating external domain:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to update external domain: ' + error.message });
      }
      request.flash('error', 'Failed to update external domain: ' + error.message);
      return reply.redirect(`/external-domains/${domainId}/edit`);
    }
  });

  // DELETE /:id - Delete an external domain
  fastify.delete('/:id', {
    schema: {
      tags: ['External Domains'],
      summary: 'Delete external domain',
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
    const domainId = parseInt(request.params.id, 10);

    try {
      const externalDomain = await ExternalDomain.findByPk(domainId);

      if (!externalDomain) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'External domain not found' });
        }
        request.flash('error', 'External domain not found');
        return reply.redirect('/external-domains');
      }

      const domainName = externalDomain.name;
      await externalDomain.destroy();

      if (request.isApiRequest()) {
        return reply.code(204).send();
      }

      request.flash('success', `External domain ${domainName} deleted successfully`);
      return reply.redirect('/external-domains');
    } catch (error) {
      fastify.log.error('Error deleting external domain:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Failed to delete external domain: ' + error.message });
      }
      request.flash('error', 'Failed to delete external domain: ' + error.message);
      return reply.redirect('/external-domains');
    }
  });
}

module.exports = externalDomainsRoutes;
