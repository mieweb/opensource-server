const fp = require('fastify-plugin');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');

/**
 * MCP Server Plugin for Fastify
 * Exposes container management tools for AI agents
 */
async function mcpPlugin(fastify, options) {
  const { Container, Job, JobStatus, Site, Node, ApiKey, User } = require('../models');
  const { createApiKeyData } = require('../utils/apikey');

  // Create MCP server instance
  const mcpServer = new McpServer({
    name: 'create-a-container',
    version: '2.0.0'
  });

  // --- Tool Definitions ---

  // List containers tool
  mcpServer.tool(
    'list_containers',
    'List all containers for a user. Returns container IDs, hostnames, status, and SSH/HTTP access info.',
    {
      type: 'object',
      properties: {
        siteId: { type: 'number', description: 'Optional site ID to filter containers' },
        hostname: { type: 'string', description: 'Optional hostname filter' }
      }
    },
    async ({ siteId, hostname }, { meta }) => {
      try {
        const where = {};
        if (hostname) where.hostname = hostname;

        let containers;
        if (siteId) {
          const nodes = await Node.findAll({ where: { siteId }, attributes: ['id'] });
          where.nodeId = nodes.map(n => n.id);
        }

        containers = await Container.findAll({
          where,
          include: [
            { association: 'services', include: [{ association: 'httpService', include: [{ association: 'externalDomain' }] }, { association: 'transportService' }] },
            { association: 'node', attributes: ['id', 'name'] },
            { association: 'site', attributes: ['id', 'name', 'externalIp'] }
          ],
          limit: 100
        });

        const results = containers.map(c => {
          const services = c.services || [];
          const ssh = services.find(s => s.type === 'transport' && s.transportService?.protocol === 'tcp' && Number(s.internalPort) === 22);
          const http = services.find(s => s.type === 'http');

          return {
            id: c.id,
            hostname: c.hostname,
            status: c.status,
            ipv4Address: c.ipv4Address,
            template: c.template,
            nodeName: c.node?.name,
            siteName: c.site?.name,
            sshPort: ssh?.transportService?.externalPort,
            sshHost: c.site?.externalIp,
            httpUrl: http?.httpService?.externalHostname && http?.httpService?.externalDomain?.name
              ? `https://${http.httpService.externalHostname}.${http.httpService.externalDomain.name}`
              : null,
            createdAt: c.createdAt
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Get container details tool
  mcpServer.tool(
    'get_container',
    'Get detailed information about a specific container by ID or hostname.',
    {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Container ID' },
        hostname: { type: 'string', description: 'Container hostname' }
      }
    },
    async ({ id, hostname }) => {
      try {
        const where = id ? { id } : { hostname };
        const container = await Container.findOne({
          where,
          include: [
            { association: 'services', include: [{ association: 'httpService', include: [{ association: 'externalDomain' }] }, { association: 'transportService' }, { association: 'dnsService' }] },
            { association: 'node', attributes: { exclude: ['secret'] } },
            { association: 'site' },
            { association: 'creationJob' }
          ]
        });

        if (!container) {
          return { content: [{ type: 'text', text: 'Container not found' }], isError: true };
        }

        return { content: [{ type: 'text', text: JSON.stringify(container, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Get job status tool
  mcpServer.tool(
    'get_job_status',
    'Get the status and output of a container creation/reconfiguration job.',
    {
      type: 'object',
      properties: {
        jobId: { type: 'number', description: 'Job ID' }
      },
      required: ['jobId']
    },
    async ({ jobId }) => {
      try {
        const job = await Job.findByPk(jobId);
        if (!job) {
          return { content: [{ type: 'text', text: 'Job not found' }], isError: true };
        }

        const statuses = await JobStatus.findAll({
          where: { jobId },
          order: [['id', 'ASC']],
          limit: 100
        });

        const output = statuses.map(s => s.output).join('\n');

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: job.id,
              status: job.status,
              command: job.command,
              createdBy: job.createdBy,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              output: output
            }, null, 2)
          }]
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // List sites tool
  mcpServer.tool(
    'list_sites',
    'List all available sites.',
    { type: 'object', properties: {} },
    async () => {
      try {
        const sites = await Site.findAll({
          include: [{ model: Node, as: 'nodes', attributes: ['id', 'name'] }],
          order: [['name', 'ASC']]
        });

        const results = sites.map(s => ({
          id: s.id,
          name: s.name,
          internalDomain: s.internalDomain,
          gateway: s.gateway,
          externalIp: s.externalIp,
          nodeCount: s.nodes?.length || 0,
          nodes: s.nodes?.map(n => ({ id: n.id, name: n.name }))
        }));

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // List nodes tool
  mcpServer.tool(
    'list_nodes',
    'List all nodes, optionally filtered by site.',
    {
      type: 'object',
      properties: {
        siteId: { type: 'number', description: 'Optional site ID filter' }
      }
    },
    async ({ siteId }) => {
      try {
        const where = siteId ? { siteId } : {};
        const nodes = await Node.findAll({
          where,
          attributes: { exclude: ['secret'] },
          include: [
            { model: Container, as: 'containers', attributes: ['id'] },
            { model: Site, as: 'site', attributes: ['id', 'name'] }
          ],
          order: [['name', 'ASC']]
        });

        const results = nodes.map(n => ({
          id: n.id,
          name: n.name,
          ipv4Address: n.ipv4Address,
          apiUrl: n.apiUrl,
          siteName: n.site?.name,
          containerCount: n.containers?.length || 0
        }));

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // --- Resource Definitions ---

  // Container resource
  mcpServer.resource(
    'container',
    'container://{id}',
    async (uri) => {
      const id = parseInt(uri.pathname.replace(/^\//, ''), 10);
      const container = await Container.findByPk(id, {
        include: [
          { association: 'services', include: [{ association: 'httpService' }, { association: 'transportService' }] },
          { association: 'node', attributes: { exclude: ['secret'] } },
          { association: 'site' }
        ]
      });

      if (!container) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Container not found' }] };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(container, null, 2)
        }]
      };
    }
  );

  // Job resource
  mcpServer.resource(
    'job',
    'job://{id}',
    async (uri) => {
      const id = parseInt(uri.pathname.replace(/^\//, ''), 10);
      const job = await Job.findByPk(id);
      const statuses = await JobStatus.findAll({
        where: { jobId: id },
        order: [['id', 'ASC']],
        limit: 500
      });

      if (!job) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Job not found' }] };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            ...job.toJSON(),
            output: statuses.map(s => s.output).join('\n')
          }, null, 2)
        }]
      };
    }
  );

  // --- HTTP SSE Transport for MCP ---
  fastify.get('/mcp/sse', {
    schema: {
      tags: ['MCP'],
      summary: 'MCP Server-Sent Events endpoint',
      description: 'Connect to the MCP server via SSE for AI agent communication'
    }
  }, async (request, reply) => {
    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    await mcpServer.connect(transport);

    request.raw.on('close', () => {
      transport.close();
    });
  });

  // MCP message endpoint for SSE transport
  fastify.post('/mcp/messages', {
    schema: {
      tags: ['MCP'],
      summary: 'MCP message endpoint',
      description: 'Send messages to the MCP server'
    }
  }, async (request, reply) => {
    // This is handled by the SSE transport
    return reply.code(200).send({ ok: true });
  });

  // Decorate fastify with MCP server for CLI usage
  fastify.decorate('mcpServer', mcpServer);
}

module.exports = fp(mcpPlugin, {
  name: 'mcp',
  dependencies: ['@fastify/session']
});
