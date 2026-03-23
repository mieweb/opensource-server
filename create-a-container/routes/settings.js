const { Setting } = require('../models');

async function settingsRoutes(fastify, options) {
  // Apply auth to all routes - admin only
  fastify.addHook('preHandler', fastify.requireAuth);
  fastify.addHook('preHandler', fastify.requireAdmin);

  // GET / - Display settings page
  fastify.get('/', {
    schema: {
      tags: ['Settings'],
      summary: 'Get system settings',
      description: 'Returns system settings (admin only)',
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          description: 'Settings',
          type: 'object',
          properties: {
            pushNotificationUrl: { type: 'string' },
            pushNotificationEnabled: { type: 'boolean' },
            pushNotificationApiKey: { type: 'string' },
            smtpUrl: { type: 'string' },
            smtpNoreplyAddress: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const settings = await Setting.getMultiple([
      'push_notification_url',
      'push_notification_enabled',
      'push_notification_api_key',
      'smtp_url',
      'smtp_noreply_address',
      'default_container_env_vars'
    ]);

    let defaultContainerEnvVars = [];
    try {
      defaultContainerEnvVars = await Setting.getDefaultContainerEnvVars();
    } catch (_) {
      // ignore malformed JSON — treat as empty
    }

    const data = {
      pushNotificationUrl: settings.push_notification_url || '',
      pushNotificationEnabled: settings.push_notification_enabled === 'true',
      pushNotificationApiKey: settings.push_notification_api_key || '',
      smtpUrl: settings.smtp_url || '',
      smtpNoreplyAddress: settings.smtp_noreply_address || '',
      defaultContainerEnvVars,
    };

    if (request.isApiRequest()) {
      return data;
    }

    return reply.view('settings/index', { ...data, req: request });
  });

  // POST / - Update settings
  fastify.post('/', {
    schema: {
      tags: ['Settings'],
      summary: 'Update system settings',
      description: 'Updates system settings (admin only)',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          push_notification_url: { type: 'string' },
          push_notification_enabled: { type: 'string' },
          push_notification_api_key: { type: 'string' },
          smtp_url: { type: 'string' },
          smtp_noreply_address: { type: 'string' }
        }
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
    const {
      push_notification_url,
      push_notification_enabled,
      push_notification_api_key,
      smtp_url,
      smtp_noreply_address,
      defaultEnvVars,
    } = request.body || {};

    const enabled = push_notification_enabled === 'on' || push_notification_enabled === 'true';

    if (enabled && (!push_notification_url || push_notification_url.trim() === '')) {
      if (request.isApiRequest()) {
        return reply.code(400).send({ error: 'Push notification URL is required when push notifications are enabled' });
      }
      request.flash('error', 'Push notification URL is required when push notifications are enabled');
      return reply.redirect('/settings');
    }

    // Build default container env vars as an array of {key, value, description} objects
    const envVarsArray = [];
    if (Array.isArray(defaultEnvVars)) {
      for (const entry of defaultEnvVars) {
        if (entry && entry.key && entry.key.trim()) {
          envVarsArray.push({
            key: entry.key.trim(),
            value: entry.value || '',
            description: entry.description || '',
          });
        }
      }
    }

    await Setting.set('push_notification_url', push_notification_url || '');
    await Setting.set('push_notification_enabled', enabled ? 'true' : 'false');
    await Setting.set('push_notification_api_key', push_notification_api_key || '');
    await Setting.set('smtp_url', smtp_url || '');
    await Setting.set('smtp_noreply_address', smtp_noreply_address || '');
    await Setting.set('default_container_env_vars', JSON.stringify(envVarsArray));

    if (request.isApiRequest()) {
      return { success: true, message: 'Settings saved successfully' };
    }

    request.flash('success', 'Settings saved successfully');
    return reply.redirect('/settings');
  });
}

module.exports = settingsRoutes;
