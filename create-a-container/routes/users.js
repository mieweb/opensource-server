const { User, Group, InviteToken, Setting } = require('../models');
const { sendInviteEmail } = require('../utils/email');
const { sendPushNotificationInvite } = require('../utils/push-notification-invite');

async function usersRoutes(fastify, options) {
  // Apply auth and admin check to all routes
  fastify.addHook('preHandler', fastify.requireAuth);
  fastify.addHook('preHandler', fastify.requireAdmin);

  // GET / - List all users
  fastify.get('/', {
    schema: {
      tags: ['Users'],
      summary: 'List all users',
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            users: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uidNumber: { type: 'integer' },
                  uid: { type: 'string' },
                  cn: { type: 'string' },
                  mail: { type: 'string' },
                  status: { type: 'string' },
                  groups: { type: 'string' },
                  isAdmin: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const users = await User.findAll({
      include: [{
        association: 'groups',
        attributes: ['gidNumber', 'cn', 'isAdmin']
      }],
      order: [['uidNumber', 'ASC']]
    });

    const rows = users.map(u => ({
      uidNumber: u.uidNumber,
      uid: u.uid,
      cn: u.cn,
      mail: u.mail,
      status: u.status,
      groups: u.groups ? u.groups.map(g => g.cn).join(', ') : '',
      isAdmin: u.groups?.some(g => g.isAdmin) || false
    }));

    if (request.isApiRequest()) {
      return { users: rows };
    }

    return reply.view('users/index', { rows, req: request });
  });

  // GET /new - Display form for creating a new user
  fastify.get('/new', async (request, reply) => {
    const groups = await Group.findAll({
      order: [['gidNumber', 'ASC']]
    });

    return reply.view('users/form', {
      user: null,
      groups,
      isEdit: false,
      req: request
    });
  });

  // GET /invite - Display form for inviting a user via email
  fastify.get('/invite', async (request, reply) => {
    return reply.view('users/invite', { req: request });
  });

  // POST /invite - Send invitation email
  fastify.post('/invite', {
    schema: {
      tags: ['Users'],
      summary: 'Send user invitation',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' }
        },
        required: ['email']
      }
    }
  }, async (request, reply) => {
    const { email } = request.body;

    if (!email || email.trim() === '') {
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Please enter an email address' });
      }
      request.flash('error', 'Please enter an email address');
      return reply.redirect('/users/invite');
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
      // Check if SMTP is configured
      const settings = await Setting.getMultiple(['smtp_url']);
      if (!settings.smtp_url || settings.smtp_url.trim() === '') {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: 'SMTP is not configured. Please configure SMTP settings before sending invitations.' });
        }
        request.flash('error', 'SMTP is not configured. Please configure SMTP settings before sending invitations.');
        return reply.redirect('/users/invite');
      }

      // Check if email is already registered
      const existingUser = await User.findOne({ where: { mail: normalizedEmail } });
      if (existingUser) {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: 'A user with this email address is already registered' });
        }
        request.flash('error', 'A user with this email address is already registered');
        return reply.redirect('/users/invite');
      }

      // Generate invite token (24-hour expiry)
      const { token } = await InviteToken.generateToken(normalizedEmail, 24);

      // Build invite URL
      const inviteUrl = `${request.protocol}://${request.hostname}/register?token=${token}`;

      // Send invite email
      try {
        await sendInviteEmail(normalizedEmail, inviteUrl);
        if (request.isApiRequest()) {
          return { success: true, message: `Invitation sent to ${normalizedEmail}` };
        }
        request.flash('success', `Invitation sent to ${normalizedEmail}`);
        return reply.redirect('/users');
      } catch (emailError) {
        fastify.log.error('Failed to send invite email:', emailError);
        if (request.isApiRequest()) {
          return reply.code(500).send({ error: 'Failed to send invitation email. Please check SMTP settings.' });
        }
        request.flash('error', 'Failed to send invitation email. Please check SMTP settings.');
        return reply.redirect('/users/invite');
      }
    } catch (error) {
      fastify.log.error('Invite error:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Failed to send invitation: ' + error.message });
      }
      request.flash('error', 'Failed to send invitation: ' + error.message);
      return reply.redirect('/users/invite');
    }
  });

  // GET /:id/edit - Display form for editing an existing user
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
    const uidNumber = parseInt(request.params.id, 10);

    const user = await User.findByPk(uidNumber, {
      include: [{ association: 'groups' }]
    });

    if (!user) {
      if (request.isApiRequest()) {
        return reply.code(404).send({ error: 'User not found' });
      }
      request.flash('error', 'User not found');
      return reply.redirect('/users');
    }

    const groups = await Group.findAll({
      order: [['gidNumber', 'ASC']]
    });

    return reply.view('users/form', {
      user,
      groups,
      isEdit: true,
      req: request
    });
  });

  // POST / - Create a new user
  fastify.post('/', {
    schema: {
      tags: ['Users'],
      summary: 'Create a new user',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          uid: { type: 'string' },
          givenName: { type: 'string' },
          sn: { type: 'string' },
          mail: { type: 'string', format: 'email' },
          userPassword: { type: 'string' },
          status: { type: 'string', enum: ['active', 'pending', 'inactive'] },
          groupIds: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }
        },
        required: ['uid', 'givenName', 'sn', 'mail', 'userPassword']
      }
    }
  }, async (request, reply) => {
    try {
      const { uid, givenName: rawGivenName, sn: rawSn, mail, userPassword, status, groupIds } = request.body;

      const givenName = rawGivenName.trim();
      const sn = rawSn.trim();

      const user = await User.create({
        uidNumber: await User.nextUidNumber(),
        uid,
        givenName,
        sn,
        cn: `${givenName} ${sn}`,
        mail,
        userPassword,
        status: status || 'pending',
        homeDirectory: `/home/${uid}`,
        loginShell: '/bin/bash',
        gidNumber: 2001
      });

      // Add user to selected groups
      if (groupIds) {
        const gids = Array.isArray(groupIds) ? groupIds : [groupIds];
        const groups = await Group.findAll({
          where: { gidNumber: gids }
        });
        await user.setGroups(groups);
      }

      if (request.isApiRequest()) {
        return reply.code(201).send({ success: true, user: { uidNumber: user.uidNumber, uid: user.uid } });
      }
      request.flash('success', `User ${uid} created successfully`);
      return reply.redirect('/users');
    } catch (error) {
      fastify.log.error('Error creating user:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to create user: ' + error.message });
      }
      request.flash('error', 'Failed to create user: ' + error.message);
      return reply.redirect('/users/new');
    }
  });

  // PUT /:id - Update an existing user
  fastify.put('/:id', {
    schema: {
      tags: ['Users'],
      summary: 'Update a user',
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
    const uidNumber = parseInt(request.params.id, 10);

    try {
      const user = await User.findByPk(uidNumber);

      if (!user) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'User not found' });
        }
        request.flash('error', 'User not found');
        return reply.redirect('/users');
      }

      const { uid, givenName: rawGivenName, sn: rawSn, mail, userPassword, status, groupIds } = request.body;

      const givenName = rawGivenName.trim();
      const sn = rawSn.trim();

      const previousStatus = user.status;

      user.uid = uid;
      user.givenName = givenName;
      user.sn = sn;
      user.cn = `${givenName} ${sn}`;
      user.mail = mail;
      user.status = status || 'pending';
      user.homeDirectory = `/home/${uid}`;

      if (userPassword && userPassword.trim() !== '') {
        user.userPassword = userPassword;
      }

      await user.save();

      // Send 2FA invite when user is first approved
      if (previousStatus !== 'active' && user.status === 'active') {
        const inviteResult = await sendPushNotificationInvite(user);
        if (inviteResult && !inviteResult.success) {
          request.flash('warning', `User approved but 2FA invite failed: ${inviteResult.error}`);
        }
      }

      // Update groups
      if (groupIds) {
        const gids = Array.isArray(groupIds) ? groupIds : [groupIds];
        const groups = await Group.findAll({
          where: { gidNumber: gids }
        });
        await user.setGroups(groups);
      } else {
        await user.setGroups([]);
      }

      if (request.isApiRequest()) {
        return { success: true, message: `User ${uid} updated successfully` };
      }
      request.flash('success', `User ${uid} updated successfully`);
      return reply.redirect('/users');
    } catch (error) {
      fastify.log.error('Error updating user:', error);
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Failed to update user: ' + error.message });
      }
      request.flash('error', 'Failed to update user: ' + error.message);
      return reply.redirect(`/users/${uidNumber}/edit`);
    }
  });

  // DELETE /:id - Delete a user
  fastify.delete('/:id', {
    schema: {
      tags: ['Users'],
      summary: 'Delete a user',
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
    const uidNumber = parseInt(request.params.id, 10);

    try {
      const user = await User.findByPk(uidNumber);

      if (!user) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'User not found' });
        }
        request.flash('error', 'User not found');
        return reply.redirect('/users');
      }

      const username = user.uid;
      await user.destroy();

      if (request.isApiRequest()) {
        return reply.code(204).send();
      }
      request.flash('success', `User ${username} deleted successfully`);
      return reply.redirect('/users');
    } catch (error) {
      fastify.log.error('Error deleting user:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Failed to delete user: ' + error.message });
      }
      request.flash('error', 'Failed to delete user: ' + error.message);
      return reply.redirect('/users');
    }
  });
}

module.exports = usersRoutes;
