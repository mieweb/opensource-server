const express = require('express');
const router = express.Router();
const { Setting } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

router.use(requireAuth);
router.use(requireAdmin);

router.get('/', async (req, res) => {
  const settings = await Setting.getMultiple([
    'push_notification_url', 
    'push_notification_enabled',
    'push_notification_api_key',
    'smtp_url',
    'smtp_noreply_address',
    'default_container_env_vars'
  ]);

  // Stored as an array of {key, value, description} objects.
  // Also handles the old flat-object format {KEY: value} from earlier installs.
  let defaultContainerEnvVars = [];
  try {
    if (settings.default_container_env_vars) {
      const parsed = JSON.parse(settings.default_container_env_vars);
      if (Array.isArray(parsed)) {
        defaultContainerEnvVars = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        defaultContainerEnvVars = Object.entries(parsed).map(([key, value]) => ({ key, value, description: '' }));
      }
    }
  } catch (_) {
    // ignore malformed JSON — treat as empty
  }
  
  res.render('settings/index', {
    pushNotificationUrl: settings.push_notification_url || '',
    pushNotificationEnabled: settings.push_notification_enabled === 'true',
    pushNotificationApiKey: settings.push_notification_api_key || '',
    smtpUrl: settings.smtp_url || '',
    smtpNoreplyAddress: settings.smtp_noreply_address || '',
    defaultContainerEnvVars,
    req
  });
});

router.post('/', async (req, res) => {
  const { 
    push_notification_url, 
    push_notification_enabled,
    push_notification_api_key,
    smtp_url,
    smtp_noreply_address,
    defaultEnvVars
  } = req.body;
  
  const enabled = push_notification_enabled === 'on';
  
  if (enabled && (!push_notification_url || push_notification_url.trim() === '')) {
    await req.flash('error', 'Push notification URL is required when push notifications are enabled');
    return res.redirect('/settings');
  }

  // Build default container env vars as an array of {key, value, description} objects.
  // Descriptions are metadata only — they are never passed to containers.
  const envVarsArray = [];
  if (Array.isArray(defaultEnvVars)) {
    for (const entry of defaultEnvVars) {
      if (entry && entry.key && entry.key.trim()) {
        envVarsArray.push({
          key: entry.key.trim(),
          value: entry.value || '',
          description: entry.description || ''
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
  
  await req.flash('success', 'Settings saved successfully');
  return res.redirect('/settings');
});

module.exports = router;
