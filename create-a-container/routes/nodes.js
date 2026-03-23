const https = require('https');
const { Node, Container, Site } = require('../models');

async function nodesRoutes(fastify, options) {
  // Apply auth and admin check to all routes
  fastify.addHook('preHandler', fastify.requireAuth);
  fastify.addHook('preHandler', fastify.requireAdmin);

  // Helper to get siteId from parent route
  function getSiteId(request) {
    return parseInt(request.params.siteId, 10);
  }

  // GET / - List all nodes for a site
  fastify.get('/', {
    schema: {
      tags: ['Nodes'],
      summary: 'List nodes for a site',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' }
        },
        required: ['siteId']
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

    const nodes = await Node.findAll({
      where: { siteId },
      include: [{ model: Container, as: 'containers', attributes: ['id'] }],
      attributes: { exclude: ['secret'] }
    });

    const rows = nodes.map(n => ({
      id: n.id,
      name: n.name,
      ipv4Address: n.ipv4Address,
      apiUrl: n.apiUrl,
      tlsVerify: n.tlsVerify,
      containerCount: n.containers ? n.containers.length : 0
    }));

    if (request.isApiRequest()) {
      return { nodes: rows };
    }

    return reply.view('nodes/index', { rows, site, req: request });
  });

  // GET /new - Display form for creating a new node
  fastify.get('/new', async (request, reply) => {
    const siteId = getSiteId(request);
    const site = await Site.findByPk(siteId);

    if (!site) {
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    return reply.view('nodes/form', {
      node: null,
      site,
      isEdit: false,
      req: request
    });
  });

  // GET /import - Display form for importing nodes
  fastify.get('/import', async (request, reply) => {
    const siteId = getSiteId(request);
    const site = await Site.findByPk(siteId);

    if (!site) {
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    return reply.view('nodes/import', { site, req: request });
  });

  // GET /:id/edit - Display form for editing a node
  fastify.get('/:id/edit', {
    schema: {
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' },
          id: { type: 'integer' }
        },
        required: ['siteId', 'id']
      }
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const nodeId = parseInt(request.params.id, 10);

    const site = await Site.findByPk(siteId);
    if (!site) {
      request.flash('error', 'Site not found');
      return reply.redirect('/sites');
    }

    const node = await Node.findOne({
      where: { id: nodeId, siteId },
      attributes: { exclude: ['secret'] }
    });

    if (!node) {
      request.flash('error', 'Node not found');
      return reply.redirect(`/sites/${siteId}/nodes`);
    }

    return reply.view('nodes/form', {
      node,
      site,
      isEdit: true,
      req: request
    });
  });

  // POST / - Create a new node
  fastify.post('/', {
    schema: {
      tags: ['Nodes'],
      summary: 'Create a new node',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' }
        },
        required: ['siteId']
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          ipv4Address: { type: 'string' },
          apiUrl: { type: 'string' },
          tokenId: { type: 'string' },
          secret: { type: 'string' },
          tlsVerify: { type: 'string' },
          imageStorage: { type: 'string' },
          volumeStorage: { type: 'string' }
        },
        required: ['name']
      }
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);

    try {
      const site = await Site.findByPk(siteId);
      if (!site) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Site not found' });
        }
        request.flash('error', 'Site not found');
        return reply.redirect('/sites');
      }

      const { name, ipv4Address, apiUrl, tokenId, secret, tlsVerify, imageStorage, volumeStorage } = request.body;

      const node = await Node.create({
        name,
        ipv4Address: ipv4Address || null,
        apiUrl: apiUrl || null,
        tokenId: tokenId || null,
        secret: secret || null,
        tlsVerify: tlsVerify === '' || tlsVerify === null ? null : tlsVerify === 'true',
        imageStorage: imageStorage || 'local',
        volumeStorage: volumeStorage || 'local-lvm',
        siteId
      });

      if (request.isApiRequest()) {
        return reply.code(201).send({ success: true, node: { id: node.id, name: node.name } });
      }

      request.flash('success', `Node ${name} created successfully`);
      return reply.redirect(`/sites/${siteId}/nodes`);
    } catch (err) {
      fastify.log.error('Error creating node:', err);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: `Failed to create node: ${err.message}` });
      }
      request.flash('error', `Failed to create node: ${err.message}`);
      return reply.redirect(`/sites/${siteId}/nodes/new`);
    }
  });

  // POST /import - Import nodes from Proxmox API
  fastify.post('/import', {
    schema: {
      tags: ['Nodes'],
      summary: 'Import nodes from Proxmox',
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

    const { apiUrl, username, password, tlsVerify } = request.body;
    const tokenId = username;
    const secret = password;

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

      const nodesWithIp = await Promise.all(nodes.map(async (n) => {
        let ipv4Address = null;
        let imageStorage = 'local';
        let volumeStorage = 'local-lvm';

        try {
          const networkInterfaces = await client.nodeNetwork(n.node);
          const primaryInterface = networkInterfaces.find(iface =>
            iface.iface === 'vmbr0' || (iface.type === 'bridge' && iface.active)
          );
          ipv4Address = primaryInterface?.address || null;
        } catch (err) {
          fastify.log.error(`Failed to fetch network info for node ${n.node}:`, err.message);
        }

        try {
          const storages = await client.datastores(n.node, 'vztmpl', true);
          if (storages.length > 0) {
            const largest = storages.reduce((max, s) => (s.total > max.total ? s : max), storages[0]);
            imageStorage = largest.storage;
          }
        } catch (err) {
          fastify.log.error(`Failed to fetch storages for node ${n.node}:`, err.message);
        }

        try {
          const storages = await client.datastores(n.node, 'rootdir', true);
          if (storages.length > 0) {
            const largest = storages.reduce((max, s) => (s.total > max.total ? s : max), storages[0]);
            volumeStorage = largest.storage;
          }
        } catch (err) {
          fastify.log.error(`Failed to fetch volume storages for node ${n.node}:`, err.message);
        }

        return {
          name: n.node,
          ipv4Address,
          apiUrl,
          tokenId,
          secret,
          tlsVerify: tlsVerify === '' || tlsVerify === null ? null : tlsVerify === 'true',
          imageStorage,
          volumeStorage,
          siteId
        };
      }));

      const importedNodes = await Node.bulkCreate(nodesWithIp);

      const containerList = await client.clusterResources('lxc');
      const containers = await Promise.all(containerList.map(async (c) => {
        const config = await client.lxcConfig(c.node, c.vmid);
        return {
          hostname: config.hostname,
          username: request.session.user,
          nodeId: importedNodes.find(n => n.name === c.node).id,
          siteId,
          containerId: c.vmid,
          macAddress: config.net0.match(/hwaddr=([0-9A-Fa-f:]+)/)[1],
          ipv4Address: config.net0.match(/ip=([^,]+)/)[1].split('/')[0],
          status: 'running'
        };
      }));
      await Container.bulkCreate(containers);

      if (request.isApiRequest()) {
        return { success: true, nodesCount: importedNodes.length, containersCount: containers.length };
      }

      return reply.redirect(`/sites/${siteId}/nodes`);
    } catch (err) {
      fastify.log.error('Import error:', err);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: `Failed to import nodes: ${err.message}` });
      }
      request.flash('error', `Failed to import nodes: ${err.message}`);
      return reply.redirect(`/sites/${siteId}/nodes/import`);
    }
  });

  // PUT /:id - Update a node
  fastify.put('/:id', {
    schema: {
      tags: ['Nodes'],
      summary: 'Update a node',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' },
          id: { type: 'integer' }
        },
        required: ['siteId', 'id']
      }
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const nodeId = parseInt(request.params.id, 10);

    try {
      const site = await Site.findByPk(siteId);
      if (!site) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Site not found' });
        }
        request.flash('error', 'Site not found');
        return reply.redirect('/sites');
      }

      const node = await Node.findOne({ where: { id: nodeId, siteId } });

      if (!node) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Node not found' });
        }
        request.flash('error', 'Node not found');
        return reply.redirect(`/sites/${siteId}/nodes`);
      }

      const { name, ipv4Address, apiUrl, tokenId, secret, tlsVerify, imageStorage, volumeStorage } = request.body;

      const updateData = {
        name,
        ipv4Address: ipv4Address || null,
        apiUrl: apiUrl || null,
        tokenId: tokenId || null,
        tlsVerify: tlsVerify === '' || tlsVerify === null ? null : tlsVerify === 'true',
        imageStorage: imageStorage || 'local',
        volumeStorage: volumeStorage || 'local-lvm'
      };

      if (secret && secret.trim() !== '') {
        updateData.secret = secret;
      }

      await node.update(updateData);

      if (request.isApiRequest()) {
        return { success: true, message: `Node ${name} updated successfully` };
      }

      request.flash('success', `Node ${name} updated successfully`);
      return reply.redirect(`/sites/${siteId}/nodes`);
    } catch (err) {
      fastify.log.error('Error updating node:', err);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: `Failed to update node: ${err.message}` });
      }
      request.flash('error', `Failed to update node: ${err.message}`);
      return reply.redirect(`/sites/${siteId}/nodes/${nodeId}/edit`);
    }
  });

  // GET /:id/storages - Get storages supporting CT templates
  fastify.get('/:id/storages', {
    schema: {
      tags: ['Nodes'],
      summary: 'Get node storages',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' },
          id: { type: 'integer' }
        },
        required: ['siteId', 'id']
      }
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const nodeId = parseInt(request.params.id, 10);

    try {
      const node = await Node.findOne({ where: { id: nodeId, siteId } });

      if (!node || !node.apiUrl || !node.tokenId || !node.secret) {
        return [];
      }

      const client = await node.api();
      const storages = await client.datastores(node.name, 'vztmpl', true);

      return storages.map(s => ({
        name: s.storage,
        total: s.total,
        available: s.avail
      }));
    } catch (err) {
      fastify.log.error('Error fetching storages:', err.message);
      return [];
    }
  });

  // DELETE /:id - Delete a node
  fastify.delete('/:id', {
    schema: {
      tags: ['Nodes'],
      summary: 'Delete a node',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          siteId: { type: 'integer' },
          id: { type: 'integer' }
        },
        required: ['siteId', 'id']
      }
    }
  }, async (request, reply) => {
    const siteId = getSiteId(request);
    const nodeId = parseInt(request.params.id, 10);

    try {
      const site = await Site.findByPk(siteId);
      if (!site) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Site not found' });
        }
        request.flash('error', 'Site not found');
        return reply.redirect('/sites');
      }

      const node = await Node.findOne({
        where: { id: nodeId, siteId },
        include: [{ model: Container, as: 'containers' }]
      });

      if (!node) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Node not found' });
        }
        request.flash('error', 'Node not found');
        return reply.redirect(`/sites/${siteId}/nodes`);
      }

      if (node.containers && node.containers.length > 0) {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: `Cannot delete node ${node.name}: ${node.containers.length} container(s) still reference this node` });
        }
        request.flash('error', `Cannot delete node ${node.name}: ${node.containers.length} container(s) still reference this node`);
        return reply.redirect(`/sites/${siteId}/nodes`);
      }

      const nodeName = node.name;
      await node.destroy();

      if (request.isApiRequest()) {
        return reply.code(204).send();
      }

      request.flash('success', `Node ${nodeName} deleted successfully`);
      return reply.redirect(`/sites/${siteId}/nodes`);
    } catch (err) {
      fastify.log.error('Error deleting node:', err);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: `Failed to delete node: ${err.message}` });
      }
      request.flash('error', `Failed to delete node: ${err.message}`);
      return reply.redirect(`/sites/${siteId}/nodes`);
    }
  });
}

module.exports = nodesRoutes;
