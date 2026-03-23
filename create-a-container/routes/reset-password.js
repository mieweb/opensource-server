const { Op } = require('sequelize');
const { User, PasswordResetToken } = require('../models');
const { sendPasswordResetEmail } = require('../utils/email');

async function resetPasswordRoutes(fastify, options) {
  // GET / - Display the form to request password reset
  fastify.get('/', {
    schema: {
      tags: ['Authentication'],
      summary: 'Password reset request page',
      description: 'Display form to request password reset'
    }
  }, async (request, reply) => {
    if (request.isApiRequest()) {
      return { message: 'Submit username or email to request password reset' };
    }

    return reply.view('reset-password/request', {
      successMessages: reply.locals?.successMessages || [],
      errorMessages: reply.locals?.errorMessages || []
    });
  });

  // POST / - Handle password reset request
  fastify.post('/', {
    schema: {
      tags: ['Authentication'],
      summary: 'Request password reset',
      description: 'Send password reset email to user',
      body: {
        type: 'object',
        properties: {
          usernameOrEmail: { type: 'string', minLength: 1 }
        },
        required: ['usernameOrEmail']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { usernameOrEmail } = request.body;

    if (!usernameOrEmail || usernameOrEmail.trim() === '') {
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Please enter your username or email address' });
      }
      request.flash('error', 'Please enter your username or email address');
      return reply.redirect('/reset-password');
    }

    try {
      const user = await User.findOne({
        where: {
          [Op.or]: [
            { uid: usernameOrEmail.trim() },
            { mail: usernameOrEmail.trim() }
          ]
        }
      });

      if (!user) {
        if (request.isApiRequest()) {
          return reply.code(404).send({ error: 'User not found' });
        }
        request.flash('error', 'User not found');
        return reply.redirect('/reset-password');
      }

      // Generate reset token
      const { token } = await PasswordResetToken.generateToken(user.uidNumber);

      // Build reset URL
      const resetUrl = `${request.protocol}://${request.hostname}/reset-password/${token}`;

      // Send email
      try {
        await sendPasswordResetEmail(user.mail, user.uid, resetUrl);

        if (request.isApiRequest()) {
          return { success: true, message: 'Password reset instructions have been sent to your email address' };
        }
        request.flash('success', 'Password reset instructions have been sent to your email address');
        return reply.redirect('/login');
      } catch (emailError) {
        fastify.log.error('Failed to send password reset email:', emailError);
        if (request.isApiRequest()) {
          return reply.code(500).send({ error: 'Password reset failed, please contact an administrator' });
        }
        request.flash('error', 'Password reset failed, please contact an administrator');
        return reply.redirect('/reset-password');
      }
    } catch (error) {
      fastify.log.error('Password reset error:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Password reset failed, please contact an administrator' });
      }
      request.flash('error', 'Password reset failed, please contact an administrator');
      return reply.redirect('/reset-password');
    }
  });

  // GET /:token - Display password reset form with token
  fastify.get('/:token', {
    schema: {
      tags: ['Authentication'],
      summary: 'Password reset form',
      description: 'Display password reset form with validated token',
      params: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        },
        required: ['token']
      }
    }
  }, async (request, reply) => {
    const { token } = request.params;

    try {
      const resetToken = await PasswordResetToken.validateToken(token);

      if (!resetToken) {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: 'Invalid or expired password reset link' });
        }
        request.flash('error', 'Invalid or expired password reset link');
        return reply.redirect('/login');
      }

      if (request.isApiRequest()) {
        return { valid: true, username: resetToken.user.uid };
      }

      return reply.view('reset-password/reset', {
        token,
        username: resetToken.user.uid,
        successMessages: reply.locals?.successMessages || [],
        errorMessages: reply.locals?.errorMessages || []
      });
    } catch (error) {
      fastify.log.error('Password reset token validation error:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Password reset failed, please contact an administrator' });
      }
      request.flash('error', 'Password reset failed, please contact an administrator');
      return reply.redirect('/login');
    }
  });

  // POST /:token - Handle password reset
  fastify.post('/:token', {
    schema: {
      tags: ['Authentication'],
      summary: 'Reset password',
      description: 'Set new password using reset token',
      params: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        },
        required: ['token']
      },
      body: {
        type: 'object',
        properties: {
          password: { type: 'string', minLength: 8 },
          confirmPassword: { type: 'string', minLength: 8 }
        },
        required: ['password', 'confirmPassword']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { token } = request.params;
    const { password, confirmPassword } = request.body;

    // Validate passwords
    if (!password || !confirmPassword) {
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Please enter and confirm your new password' });
      }
      request.flash('error', 'Please enter and confirm your new password');
      return reply.redirect(`/reset-password/${token}`);
    }

    if (password !== confirmPassword) {
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Passwords do not match' });
      }
      request.flash('error', 'Passwords do not match');
      return reply.redirect(`/reset-password/${token}`);
    }

    if (password.length < 8) {
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Password must be at least 8 characters long' });
      }
      request.flash('error', 'Password must be at least 8 characters long');
      return reply.redirect(`/reset-password/${token}`);
    }

    try {
      const resetToken = await PasswordResetToken.validateToken(token);

      if (!resetToken) {
        if (request.isApiRequest()) {
          return reply.code(400).send({ error: 'Invalid or expired password reset link' });
        }
        request.flash('error', 'Invalid or expired password reset link');
        return reply.redirect('/login');
      }

      const user = resetToken.user;
      await user.setPassword(password);
      await resetToken.markAsUsed();

      if (request.isApiRequest()) {
        return { success: true, message: 'Your password has been reset successfully. Please log in with your new password.' };
      }
      request.flash('success', 'Your password has been reset successfully. Please log in with your new password.');
      return reply.redirect('/login');
    } catch (error) {
      fastify.log.error('Password reset error:', error);
      if (request.isApiRequest()) {
        return reply.code(500).send({ error: 'Password reset failed, please contact an administrator' });
      }
      request.flash('error', 'Password reset failed, please contact an administrator');
      return reply.redirect(`/reset-password/${token}`);
    }
  });
}

module.exports = resetPasswordRoutes;
