const fs = require('fs');
const path = require('path');
const { User, Setting } = require('../models');
const { isSafeRelativeUrl } = require('../utils');

// Check if we're in dev mode (no .env file or NODE_ENV !== 'production')
function isDevMode() {
  const envPath = path.join(__dirname, '..', '.env');
  const hasEnvFile = fs.existsSync(envPath);
  return !hasEnvFile || process.env.NODE_ENV !== 'production';
}

// JSON Schema for request/response validation
const loginSchema = {
  body: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 1 },
      password: { type: 'string', minLength: 1 },
      redirect: { type: 'string' }
    },
    required: ['username', 'password']
  }
};

const quickLoginSchema = {
  body: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['admin', 'user'] }
    }
  }
};

async function loginRoutes(fastify, options) {
  // GET / - Display login form
  fastify.get('/', {
    schema: {
      tags: ['Authentication'],
      summary: 'Login page',
      description: 'Display login form or return login status for API requests',
      response: {
        200: {
          description: 'Login form or status',
          type: 'object',
          properties: {
            authenticated: { type: 'boolean' },
            noUsers: { type: 'boolean' },
            showQuickLogin: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const userCount = await User.count();
    const devMode = isDevMode();

    if (request.isApiRequest()) {
      return {
        authenticated: !!request.session?.user,
        noUsers: userCount === 0,
        showQuickLogin: devMode
      };
    }

    return reply.view('login', {
      successMessages: reply.locals?.successMessages || [],
      errorMessages: reply.locals?.errorMessages || [],
      warningMessages: reply.locals?.warningMessages || [],
      redirect: request.query.redirect || '/',
      noUsers: userCount === 0,
      showQuickLogin: devMode
    });
  });

  // POST /quick - Create test user and auto-login (dev mode only)
  fastify.post('/quick', {
    schema: quickLoginSchema
  }, async (request, reply) => {
    // Only allow in dev mode
    if (!isDevMode()) {
      if (request.isApiRequest()) {
        return reply.code(403).send({ error: 'Quick login is only available in development mode' });
      }
      request.flash('error', 'Quick login is only available in development mode');
      return reply.redirect('/login');
    }

    const role = request.body.role || 'admin';
    const isAdmin = role === 'admin';
    const username = isAdmin ? 'admin' : 'testuser';
    const displayName = isAdmin ? 'Admin User' : 'Test User';

    try {
      // Find existing user or create new one
      let user = await User.findOne({
        where: { uid: username },
        include: [{ association: 'groups' }]
      });

      if (!user) {
        user = await User.create({
          uidNumber: await User.nextUidNumber(),
          uid: username,
          givenName: isAdmin ? 'Admin' : 'Test',
          sn: 'User',
          cn: displayName,
          mail: `${username}@localhost`,
          userPassword: 'test',
          status: 'active',
          homeDirectory: `/home/${username}`,
        });

        // For admin users, ensure they're in sysadmins group
        if (isAdmin) {
          const { Group } = require('../models');
          const sysadminsGroup = await Group.findByPk(2000);
          if (sysadminsGroup) {
            await user.addGroup(sysadminsGroup);
          }
        }
        // Reload user with groups
        user = await User.findOne({
          where: { uid: username },
          include: [{ association: 'groups' }]
        });
      }

      // Auto-login: set session variables based on user's actual groups
      const userIsAdmin = user.groups?.some(g => g.isAdmin) || false;
      request.session.user = user.uid;
      request.session.isAdmin = userIsAdmin;

      if (request.isApiRequest()) {
        return { success: true, user: user.uid, isAdmin: userIsAdmin };
      }

      return reply.redirect('/');
    } catch (err) {
      fastify.log.error('Quick login error:', err);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Failed to create user: ' + err.message });
      }
      request.flash('error', 'Failed to create user: ' + err.message);
      return reply.redirect('/login');
    }
  });

  // POST / - Handle login submission
  fastify.post('/', {
    schema: {
      tags: ['Authentication'],
      summary: 'Login',
      description: 'Authenticate user with username and password',
      body: loginSchema.body,
      response: {
        200: {
          description: 'Login successful',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            user: { type: 'string' },
            isAdmin: { type: 'boolean' },
            redirect: { type: 'string' }
          }
        },
        401: {
          description: 'Invalid credentials',
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body;

    const user = await User.findOne({
      where: { uid: username },
      include: [{ association: 'groups' }]
    });

    if (!user) {
      if (request.isApiRequest()) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }
      request.flash('error', 'Invalid username or password');
      return reply.redirect('/login');
    }

    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      if (request.isApiRequest()) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }
      request.flash('error', 'Invalid username or password');
      return reply.redirect('/login');
    }

    if (user.status !== 'active') {
      if (request.isApiRequest()) {
        return reply.code(401).send({ error: 'Account is not active. Please contact the administrator.' });
      }
      request.flash('error', 'Account is not active. Please contact the administrator.');
      return reply.redirect('/login');
    }

    // Check if push notification 2FA is enabled
    const settings = await Setting.getMultiple(['push_notification_url', 'push_notification_enabled']);
    const pushNotificationUrl = settings.push_notification_url || '';
    const pushNotificationEnabled = settings.push_notification_enabled === 'true';

    if (pushNotificationEnabled && pushNotificationUrl.trim() !== '') {
      const notificationPayload = {
        username: user.uid,
        title: 'Authentication Request',
        body: 'Please review and respond to your pending authentication request.',
        actions: [
          { icon: 'approve', title: 'Approve', callback: 'approve' },
          { icon: 'reject', title: 'Reject', callback: 'reject' }
        ]
      };

      try {
        const response = await fetch(`${pushNotificationUrl}/send-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notificationPayload)
        });

        const result = await response.json();

        // Check for user not registered errors
        if (result.success === false &&
            (result.error?.includes('No device found with this Username') ||
             result.error?.includes('User not found'))) {
          const errorMsg = `No device found with this username. Please register your device at: ${pushNotificationUrl}`;
          if (request.isApiRequest()) {
            return reply.code(401).send({ error: errorMsg, registrationUrl: pushNotificationUrl });
          }
          request.flash('error', `No device found with this username. Please register your device at: <a href="${pushNotificationUrl}" target="_blank" rel="noopener noreferrer" style="color: #721c24; text-decoration: underline;">${pushNotificationUrl}</a>`);
          return reply.redirect('/login');
        }

        if (!response.ok) {
          if (request.isApiRequest()) {
            return reply.code(500).send({ error: 'Failed to send push notification. Please contact support.' });
          }
          request.flash('error', 'Failed to send push notification. Please contact support.');
          return reply.redirect('/login');
        }

        if (result.action !== 'approve') {
          let errorMsg;
          if (result.action === 'reject') {
            errorMsg = 'Second factor push notification was denied.';
          } else if (result.action === 'timeout') {
            errorMsg = 'Second factor push notification timed out. Please try again.';
          } else {
            errorMsg = `Second factor push notification failed: ${result.action}. Please contact support.`;
          }
          if (request.isApiRequest()) {
            return reply.code(401).send({ error: errorMsg });
          }
          request.flash('error', errorMsg);
          return reply.redirect('/login');
        }
      } catch (error) {
        fastify.log.error('Push notification error:', error);
        if (request.isApiRequest()) {
          return reply.code(500).send({ error: 'Failed to send push notification. Please contact support.' });
        }
        request.flash('error', 'Failed to send push notification. Please contact support.');
        return reply.redirect('/login');
      }
    }

    // Set session variables
    request.session.user = user.uid;
    request.session.isAdmin = user.groups?.some(group => group.isAdmin) || false;

    // Return redirect to original page or default to home
    let redirectUrl = request.body.redirect || '/';
    if (!isSafeRelativeUrl(redirectUrl)) {
      redirectUrl = '/';
    }

    if (request.isApiRequest()) {
      return {
        success: true,
        user: user.uid,
        isAdmin: request.session.isAdmin,
        redirect: redirectUrl
      };
    }

    return reply.redirect(redirectUrl);
  });
}

module.exports = loginRoutes;
