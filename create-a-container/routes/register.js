const QRCode = require('qrcode');
const { User, InviteToken, Setting } = require('../models');
const { sendPushNotificationInvite } = require('../utils/push-notification-invite');

async function registerRoutes(fastify, options) {
  // GET / - Display registration form
  fastify.get('/', {
    schema: {
      tags: ['Authentication'],
      summary: 'Registration page',
      description: 'Display registration form',
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Invitation token' }
        }
      }
    }
  }, async (request, reply) => {
    const { token } = request.query;
    let inviteEmail = null;
    let validToken = null;

    // If token provided, validate it and extract email
    if (token) {
      const inviteToken = await InviteToken.validateToken(token);
      if (inviteToken) {
        inviteEmail = inviteToken.email;
        validToken = token;
      } else {
        request.flash('error', 'Invalid or expired invitation link. Please request a new invitation.');
      }
    }

    if (request.isApiRequest()) {
      return {
        inviteEmail,
        inviteToken: validToken,
        valid: !!validToken
      };
    }

    return reply.view('register', {
      successMessages: reply.locals?.successMessages || [],
      errorMessages: reply.locals?.errorMessages || [],
      warningMessages: reply.locals?.warningMessages || [],
      inviteEmail,
      inviteToken: validToken
    });
  });

  // GET /success - Display QR code after invite-token registration
  fastify.get('/success', {
    schema: {
      tags: ['Authentication'],
      summary: 'Registration success page',
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { token } = request.query;

    if (!token) {
      return reply.redirect('/login');
    }

    const notificationUrl = await Setting.get('push_notification_url');
    if (!notificationUrl?.trim()) {
      return reply.redirect('/login');
    }

    const inviteUrl = `${notificationUrl.trim()}/register?token=${encodeURIComponent(token)}`;
    const qrCodeDataUri = await QRCode.toDataURL(inviteUrl, { width: 256 });

    if (request.isApiRequest()) {
      return { qrCodeDataUri, inviteUrl };
    }

    return reply.view('register-success', { qrCodeDataUri, inviteUrl });
  });

  // POST / - Handle registration submission
  fastify.post('/', {
    schema: {
      tags: ['Authentication'],
      summary: 'Register new user',
      description: 'Create a new user account',
      body: {
        type: 'object',
        properties: {
          uid: { type: 'string', minLength: 1 },
          givenName: { type: 'string', minLength: 1 },
          sn: { type: 'string', minLength: 1 },
          mail: { type: 'string', format: 'email' },
          userPassword: { type: 'string', minLength: 8 },
          inviteToken: { type: 'string' }
        },
        required: ['uid', 'givenName', 'sn', 'mail', 'userPassword']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            redirect: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { inviteToken } = request.body;
    let isInvitedUser = false;
    let validatedInvite = null;

    // If invite token provided, validate it matches the email
    if (inviteToken) {
      validatedInvite = await InviteToken.validateToken(inviteToken);
      if (!validatedInvite) {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: 'Invalid or expired invitation link. Please request a new invitation.' });
        }
        request.flash('error', 'Invalid or expired invitation link. Please request a new invitation.');
        return reply.redirect('/register');
      }

      // Ensure email matches the invite
      const submittedEmail = request.body.mail.toLowerCase().trim();
      if (submittedEmail !== validatedInvite.email) {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: 'Email address does not match the invitation.' });
        }
        request.flash('error', 'Email address does not match the invitation.');
        return reply.redirect(`/register?token=${inviteToken}`);
      }

      isInvitedUser = true;
    }

    // Determine user status
    let status;
    let isFirstUser = false;
    if (await User.count() === 0) {
      status = 'active';
      isFirstUser = true;
    } else if (isInvitedUser) {
      status = 'active';
    } else {
      status = 'pending';
    }

    const givenName = request.body.givenName.trim();
    const sn = request.body.sn.trim();

    const userParams = {
      uidNumber: await User.nextUidNumber(),
      uid: request.body.uid,
      sn,
      givenName,
      mail: request.body.mail,
      userPassword: request.body.userPassword,
      status,
      cn: `${givenName} ${sn}`,
      homeDirectory: `/home/${request.body.uid}`,
    };

    try {
      await User.create(userParams);

      // Mark invite token as used
      if (validatedInvite) {
        await validatedInvite.markAsUsed();
      }

      if (isInvitedUser) {
        const inviteResult = await sendPushNotificationInvite(userParams);

        if (inviteResult?.success && inviteResult.inviteUrl) {
          let validUrl = false;
          try {
            const parsed = new URL(inviteResult.inviteUrl);
            validUrl = parsed.protocol === 'https:' || parsed.protocol === 'http:';
          } catch { /* invalid URL */ }

          if (validUrl) {
            const inviteToken2fa = new URL(inviteResult.inviteUrl).searchParams.get('token');
            if (inviteToken2fa) {
              if (request.isApiRequest()) {
                return { success: true, message: 'Account created', redirect: `/register/success?token=${encodeURIComponent(inviteToken2fa)}` };
              }
              return reply.redirect(303, `/register/success?token=${encodeURIComponent(inviteToken2fa)}`);
            }
          }
          inviteResult.error = 'Invalid invite URL returned by 2FA service';
        }

        if (inviteResult?.error) {
          request.flash('warning', `Account created, but 2FA invite failed: ${inviteResult.error}`);
        }
        request.flash('success', 'Account created successfully! You can now log in.');
      } else if (isFirstUser) {
        request.flash('success', 'Admin account created successfully! You can now log in.');
      } else {
        request.flash('success', 'Account registered successfully. You will be notified via email once approved.');
      }

      if (request.isApiRequest()) {
        return { success: true, message: 'Account created successfully', redirect: '/login' };
      }
      return reply.redirect('/login');
    } catch (err) {
      fastify.log.error('Registration error:', err);

      let errorMessage = 'Registration failed: ' + err.message;

      if (err.name === 'SequelizeUniqueConstraintError' && err.errors && err.errors.length > 0) {
        const field = err.errors[0]?.path;
        if (field === 'uid') {
          errorMessage = 'This username is already registered. Please choose a different username or login with your existing account.';
        } else if (field === 'mail') {
          errorMessage = 'This email address is already registered. Please use a different email or login with your existing account.';
        } else {
          errorMessage = 'A user with these details is already registered. Please login with your existing account.';
        }
      }

      if (request.isApiRequest()) {
        return reply.code(400).send({ error: errorMessage });
      }

      request.flash('error', errorMessage);
      const redirectUrl = inviteToken ? `/register?token=${inviteToken}` : '/register';
      return reply.redirect(redirectUrl);
    }
  });
}

module.exports = registerRoutes;
