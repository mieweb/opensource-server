const { Group, User } = require('../models');

async function groupsRoutes(fastify, options) {
  // Apply auth and admin check to all routes
  fastify.addHook('preHandler', fastify.requireAuth);
  fastify.addHook('preHandler', fastify.requireAdmin);

  // GET / - List all groups
  fastify.get('/', {
    schema: {
      tags: ['Groups'],
      summary: 'List all groups',
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  gidNumber: { type: 'integer' },
                  cn: { type: 'string' },
                  isAdmin: { type: 'boolean' },
                  userCount: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const groups = await Group.findAll({
      include: [{
        model: User,
        as: 'users',
        attributes: ['uidNumber', 'uid'],
        through: { attributes: [] }
      }],
      order: [['gidNumber', 'ASC']]
    });

    const rows = groups.map(g => ({
      gidNumber: g.gidNumber,
      cn: g.cn,
      isAdmin: g.isAdmin,
      userCount: g.users ? g.users.length : 0
    }));

    if (request.isApiRequest()) {
      return { groups: rows };
    }

    return reply.view('groups/index', { rows, req: request });
  });

  // GET /new - Display form for creating a new group
  fastify.get('/new', async (request, reply) => {
    return reply.view('groups/form', {
      group: null,
      isEdit: false,
      req: request
    });
  });

  // GET /:id/edit - Display form for editing an existing group
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
    const group = await Group.findByPk(request.params.id);

    if (!group) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'Group not found' });
      }
      request.flash('error', 'Group not found');
      return reply.redirect('/groups');
    }

    return reply.view('groups/form', {
      group,
      isEdit: true,
      req: request
    });
  });

  // POST / - Create a new group
  fastify.post('/', {
    schema: {
      tags: ['Groups'],
      summary: 'Create a new group',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          gidNumber: { type: 'integer' },
          cn: { type: 'string' },
          isAdmin: { type: 'string' }
        },
        required: ['gidNumber', 'cn']
      }
    }
  }, async (request, reply) => {
    try {
      const { gidNumber, cn, isAdmin } = request.body;

      const group = await Group.create({
        gidNumber: parseInt(gidNumber),
        cn,
        isAdmin: isAdmin === 'on' || isAdmin === 'true'
      });

      if (request.isApiRequest()) {
        return reply.code(201).send({ success: true, group: { gidNumber: group.gidNumber, cn: group.cn } });
      }
      request.flash('success', `Group ${cn} created successfully`);
      return reply.redirect('/groups');
    } catch (error) {
      fastify.log.error('Error creating group:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to create group: ' + error.message });
      }
      request.flash('error', 'Failed to create group: ' + error.message);
      return reply.redirect('/groups/new');
    }
  });

  // PUT /:id - Update an existing group
  fastify.put('/:id', {
    schema: {
      tags: ['Groups'],
      summary: 'Update a group',
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
      const group = await Group.findByPk(request.params.id);

      if (!group) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Group not found' });
        }
        request.flash('error', 'Group not found');
        return reply.redirect('/groups');
      }

      const { cn, isAdmin } = request.body;

      await group.update({
        cn,
        isAdmin: isAdmin === 'on' || isAdmin === 'true'
      });

      if (request.isApiRequest()) {
        return { success: true, message: `Group ${cn} updated successfully` };
      }
      request.flash('success', `Group ${cn} updated successfully`);
      return reply.redirect('/groups');
    } catch (error) {
      fastify.log.error('Error updating group:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to update group: ' + error.message });
      }
      request.flash('error', 'Failed to update group: ' + error.message);
      return reply.redirect(`/groups/${request.params.id}/edit`);
    }
  });

  // DELETE /:id - Delete a group
  fastify.delete('/:id', {
    schema: {
      tags: ['Groups'],
      summary: 'Delete a group',
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
      const group = await Group.findByPk(request.params.id);

      if (!group) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'Group not found' });
        }
        request.flash('error', 'Group not found');
        return reply.redirect('/groups');
      }

      const groupName = group.cn;
      await group.destroy();

      if (request.isApiRequest()) {
        return reply.code(204).send();
      }
      request.flash('success', `Group ${groupName} deleted successfully`);
      return reply.redirect('/groups');
    } catch (error) {
      fastify.log.error('Error deleting group:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Failed to delete group: ' + error.message });
      }
      request.flash('error', 'Failed to delete group: ' + error.message);
      return reply.redirect('/groups');
    }
  });
}

module.exports = groupsRoutes;
