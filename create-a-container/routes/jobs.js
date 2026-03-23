const { Job, JobStatus, Container, Node, sequelize, Sequelize } = require('../models');

async function canAccessJob(job, request) {
  const username = request.session?.user;
  const isAdmin = request.session?.isAdmin;
  return isAdmin || job.createdBy === username;
}

async function jobsRoutes(fastify, options) {
  // All job endpoints require authentication
  fastify.addHook('preHandler', fastify.requireAuth);

  // POST / - enqueue a new job (admins only)
  fastify.post('/', {
    preHandler: [fastify.requireAdmin],
    schema: {
      tags: ['Jobs'],
      summary: 'Create a new job',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 1, maxLength: 2000 }
        },
        required: ['command']
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { command } = request.body;
      if (!command || typeof command !== 'string' || command.trim().length === 0) {
        return reply.code(400).send({ error: 'command is required' });
      }

      if (command.length > 2000) {
        return reply.code(400).send({ error: 'command too long' });
      }

      const owner = request.session?.user || null;
      const job = await Job.create({ command: command.trim(), createdBy: owner });
      return reply.code(201).send({ id: job.id, status: job.status });
    } catch (err) {
      fastify.log.error('Failed to enqueue job:', err);
      return reply.code(500).send({ error: 'Failed to create job' });
    }
  });

  // GET /:id - job metadata (HTML or JSON)
  fastify.get('/:id', {
    schema: {
      tags: ['Jobs'],
      summary: 'Get job details',
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
      const id = parseInt(request.params.id, 10);
      const job = await Job.findByPk(id);

      if (!job) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Job not found' });
        }
        request.flash('error', 'Job not found');
        return reply.redirect('/');
      }

      if (!await canAccessJob(job, request)) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Job not found' });
        }
        request.flash('error', 'Job not found');
        return reply.redirect('/');
      }

      if (request.isApiRequest()) {
        return {
          id: job.id,
          command: job.command,
          status: job.status,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          createdBy: job.createdBy
        };
      }

      const initialOutput = await JobStatus.findAll({
        where: { jobId: id },
        order: [['id', 'ASC']],
        limit: 1000
      });

      const container = await Container.findOne({
        where: { creationJobId: id },
        include: [{ model: Node, as: 'node' }]
      });

      return reply.view('jobs/show', {
        job,
        initialOutput,
        container,
        req: request
      });
    } catch (err) {
      fastify.log.error('Failed to fetch job:', err);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Failed to fetch job' });
      }
      request.flash('error', 'Failed to load job');
      return reply.redirect('/');
    }
  });

  // GET /:id/stream - SSE endpoint for streaming job output
  fastify.get('/:id/stream', {
    schema: {
      tags: ['Jobs'],
      summary: 'Stream job output (SSE)',
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
    const id = parseInt(request.params.id, 10);

    try {
      const job = await Job.findByPk(id);
      if (!job || !await canAccessJob(job, request)) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      // Set up SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      let lastId = request.query.lastId ? parseInt(request.query.lastId, 10) : 0;
      let isRunning = true;

      const keepaliveInterval = setInterval(() => {
        if (isRunning) {
          reply.raw.write(':keepalive\n\n');
        }
      }, 15000);

      const pollInterval = setInterval(async () => {
        try {
          const newLogs = await JobStatus.findAll({
            where: {
              jobId: id,
              id: { [Sequelize.Op.gt]: lastId }
            },
            order: [['id', 'ASC']],
            limit: 100
          });

          for (const log of newLogs) {
            reply.raw.write(`event: log\ndata: ${JSON.stringify({ id: log.id, output: log.output, timestamp: log.createdAt })}\n\n`);
            lastId = log.id;
          }

          const currentJob = await Job.findByPk(id);
          if (!currentJob || !['pending', 'running'].includes(currentJob.status)) {
            reply.raw.write(`event: status\ndata: ${JSON.stringify({ status: currentJob ? currentJob.status : 'unknown' })}\n\n`);
            cleanup();
            reply.raw.end();
          }
        } catch (err) {
          fastify.log.error('SSE poll error:', err);
        }
      }, 2000);

      function cleanup() {
        isRunning = false;
        clearInterval(keepaliveInterval);
        clearInterval(pollInterval);
      }

      request.raw.on('close', cleanup);
    } catch (err) {
      fastify.log.error('SSE setup error:', err);
      return reply.code(500).send({ error: 'Failed to start stream' });
    }
  });

  // GET /:id/status - fetch job status rows
  fastify.get('/:id/status', {
    schema: {
      tags: ['Jobs'],
      summary: 'Get job status logs',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' }
        },
        required: ['id']
      },
      querystring: {
        type: 'object',
        properties: {
          offset: { type: 'integer', default: 0 },
          limit: { type: 'integer', default: 1000, maximum: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      const offset = Math.max(0, parseInt(request.query.offset, 10) || 0);
      const limit = Math.min(1000, parseInt(request.query.limit, 10) || 1000);

      const job = await Job.findByPk(id);
      if (!job || !await canAccessJob(job, request)) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      const rows = await JobStatus.findAll({
        where: { jobId: id },
        order: [['createdAt', 'ASC']],
        limit,
        offset
      });

      return rows;
    } catch (err) {
      fastify.log.error('Failed to fetch job status:', err);
      return reply.code(500).send({ error: 'Failed to fetch job status' });
    }
  });
}

module.exports = jobsRoutes;
