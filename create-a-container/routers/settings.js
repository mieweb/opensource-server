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
    'smtp_url',
    'smtp_noreply_address',
    'default_container_env_vars',
    'wazuh_api_url',
    'wazuh_enrollment_password'
  ]);

  let defaultContainerEnvVars = {};
  try {
    if (settings.default_container_env_vars) {
      defaultContainerEnvVars = JSON.parse(settings.default_container_env_vars);
    }
  } catch (_) {
    // ignore malformed JSON — treat as empty
  }
  
  res.render('settings/index', {
    pushNotificationUrl: settings.push_notification_url || '',
    pushNotificationEnabled: settings.push_notification_enabled === 'true',
    smtpUrl: settings.smtp_url || '',
    smtpNoreplyAddress: settings.smtp_noreply_address || '',
    defaultContainerEnvVars,
    wazuhApiUrl: settings.wazuh_api_url || '',
    // Don't echo the password back — only indicate whether it's saved
    wazuhPasswordSet: !!(settings.wazuh_enrollment_password),
    req
  });
});

router.post('/', async (req, res) => {
  const { 
    push_notification_url, 
    push_notification_enabled,
    smtp_url,
    smtp_noreply_address,
    defaultEnvVars,
    wazuh_api_url,
    wazuh_enrollment_password
  } = req.body;
  
  const enabled = push_notification_enabled === 'on';
  
  if (enabled && (!push_notification_url || push_notification_url.trim() === '')) {
    await req.flash('error', 'Push notification URL is required when push notifications are enabled');
    return res.redirect('/settings');
  }

  // Validate Wazuh API URL if provided
  if (wazuh_api_url && wazuh_api_url.trim()) {
    try {
      new URL(wazuh_api_url.trim());
    } catch (_) {
      await req.flash('error', 'Wazuh API URL must be a valid URL (e.g. https://wazuh.example.com:55000)');
      return res.redirect('/settings');
    }
  }

  // Build default container env vars object from form array
  const envVarsObj = {};
  if (Array.isArray(defaultEnvVars)) {
    for (const entry of defaultEnvVars) {
      if (entry && entry.key && entry.key.trim()) {
        envVarsObj[entry.key.trim()] = entry.value || '';
      }
    }
  }
  
  await Setting.set('push_notification_url', push_notification_url || '');
  await Setting.set('push_notification_enabled', enabled ? 'true' : 'false');
  await Setting.set('smtp_url', smtp_url || '');
  await Setting.set('smtp_noreply_address', smtp_noreply_address || '');
  await Setting.set('default_container_env_vars', JSON.stringify(envVarsObj));
  await Setting.set('wazuh_api_url', wazuh_api_url ? wazuh_api_url.trim() : '');
  // Only update the password if a new value was submitted; empty = keep existing
  if (wazuh_enrollment_password && wazuh_enrollment_password.trim()) {
    await Setting.set('wazuh_enrollment_password', wazuh_enrollment_password.trim());
  }
  
  await req.flash('success', 'Settings saved successfully');
  return res.redirect('/settings');
});

module.exports = router;
