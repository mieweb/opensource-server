const { ApiKey, User } = require('../models');
const { createApiKeyData } = require('../utils/apikey');

// JSON Schemas for auto-documentation
const apiKeySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    keyPrefix: { type: 'string' },
    description: { type: 'string' },
    lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

const createApiKeySchema = {
  body: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Human-readable label for this key' }
    }
  }
};

async function apikeysRoutes(fastify, options) {
  // Apply auth to all routes
  fastify.addHook('preHandler', fastify.requireAuth);

  // GET / - List all API keys for current user
  fastify.get('/', {
    schema: {
      tags: ['API Keys'],
      summary: 'List API keys',
      description: 'Returns all API keys belonging to the authenticated user. The full key value is never returned — only the prefix.',
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          description: 'List of API keys',
          type: 'object',
          properties: {
            apiKeys: { type: 'array', items: apiKeySchema }
          }
        }
      }
    }
  }, async (request, reply) => {
    const user = await User.findOne({ where: { uid: request.session.user } });
    if (!user) {
      if (request.isApiRequest()) {
        return reply.code(401).send({ error: 'User not found' });
      }
      request.flash('error', 'User not found');
      return reply.redirect('/login');
    }

    const apiKeys = await ApiKey.findAll({
      where: { uidNumber: user.uidNumber },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt']
    });

    if (request.isApiRequest()) {
      return { apiKeys };
    }

    return reply.view('apikeys/index', { apiKeys, req: request });
  });

  // GET /new - Display form for creating a new API key
  fastify.get('/new', {
    schema: {
      tags: ['API Keys'],
      summary: 'New API key form',
      description: 'Display form for creating a new API key (HTML only)'
    }
  }, async (request, reply) => {
    return reply.view('apikeys/form', { req: request });
  });

  // POST / - Create a new API key
  fastify.post('/', {
    schema: {
      tags: ['API Keys'],
      summary: 'Create an API key',
      description: 'Creates a new API key. The full key is returned **only once** in the response. Store it securely — it cannot be retrieved again.',
      security: [{ BearerAuth: [] }],
      body: createApiKeySchema.body,
      response: {
        201: {
          description: 'API key created',
          type: 'object',
          properties: {
            apiKey: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                key: { type: 'string', description: 'Full API key (shown only once)' },
                keyPrefix: { type: 'string' },
                description: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' }
              }
            },
            warning: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const user = await User.findOne({ where: { uid: request.session.user } });
    if (!user) {
      if (request.isApiRequest()) {
        return reply.code(401).send({ error: 'User not found' });
      }
      request.flash('error', 'User not found');
      return reply.redirect('/login');
    }

    const { description } = request.body || {};
    const apiKeyData = await createApiKeyData(user.uidNumber, description);

    const apiKey = await ApiKey.create({
      uidNumber: apiKeyData.uidNumber,
      keyPrefix: apiKeyData.keyPrefix,
      keyHash: apiKeyData.keyHash,
      description: apiKeyData.description
    });

    if (request.isApiRequest()) {
      return reply.code(201).send({
        apiKey: {
          id: apiKey.id,
          key: apiKeyData.plainKey,
          keyPrefix: apiKey.keyPrefix,
          description: apiKey.description,
          createdAt: apiKey.createdAt
        },
        warning: 'This is the only time the full API key will be displayed. Please store it securely.'
      });
    }

    request.flash('success', 'API key created successfully. This is the only time it will be shown!');
    return reply.view('apikeys/created', {
      plainKey: apiKeyData.plainKey,
      apiKey,
      req: request
    });
  });

  // GET /:id - Show details of a specific API key
  fastify.get('/:id', {
    schema: {
      tags: ['API Keys'],
      summary: 'Get API key details',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        },
        required: ['id']
      },
      response: {
        200: {
          description: 'API key details',
          type: 'object',
          properties: {
            apiKey: apiKeySchema
          }
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    const user = await User.findOne({ where: { uid: request.session.user } });
    if (!user) {
      if (request.isApiRequest()) {
        return reply.code(401).send({ error: 'User not found' });
      }
      request.flash('error', 'User not found');
      return reply.redirect('/login');
    }

    const { id } = request.params;
    const apiKey = await ApiKey.findOne({
      where: { id, uidNumber: user.uidNumber },
      attributes: ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt']
    });

    if (!apiKey) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'API key not found' });
      }
      request.flash('error', 'API key not found');
      return reply.redirect('/apikeys');
    }

    if (request.isApiRequest()) {
      return { apiKey };
    }

    return reply.view('apikeys/show', { apiKey, req: request });
  });

  // DELETE /:id - Delete an API key
  fastify.delete('/:id', {
    schema: {
      tags: ['API Keys'],
      summary: 'Delete an API key',
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        },
        required: ['id']
      },
      response: {
        204: { description: 'API key deleted' },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    const user = await User.findOne({ where: { uid: request.session.user } });
    if (!user) {
      if (request.isApiRequest()) {
        return reply.code(401).send({ error: 'User not found' });
      }
      request.flash('error', 'User not found');
      return reply.redirect('/login');
    }

    const { id } = request.params;
    const apiKey = await ApiKey.findOne({
      where: { id, uidNumber: user.uidNumber }
    });

    if (!apiKey) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'API key not found' });
      }
      request.flash('error', 'API key not found');
      return reply.redirect('/apikeys');
    }

    await apiKey.destroy();

    if (request.isApiRequest()) {
      return reply.code(204).send();
    }

    request.flash('success', 'API key deleted successfully');
    return reply.redirect('/apikeys');
  });
}

module.exports = apikeysRoutes;
