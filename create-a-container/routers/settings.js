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
    'base_url'
  ]);
  
  res.render('settings/index', {
    pushNotificationUrl: settings.push_notification_url || '',
    pushNotificationEnabled: settings.push_notification_enabled === 'true',
    smtpUrl: settings.smtp_url || '',
    smtpNoreplyAddress: settings.smtp_noreply_address || '',
    baseUrl: settings.base_url || '',
    req
  });
});

router.post('/', async (req, res) => {
  const { 
    push_notification_url, 
    push_notification_enabled,
    smtp_url,
    smtp_noreply_address,
    base_url
  } = req.body;
  
  const enabled = push_notification_enabled === 'on';
  
  if (enabled && (!push_notification_url || push_notification_url.trim() === '')) {
    await req.flash('error', 'Push notification URL is required when push notifications are enabled');
    return res.redirect('/settings');
  }
  
  await Setting.set('push_notification_url', push_notification_url || '');
  await Setting.set('push_notification_enabled', enabled ? 'true' : 'false');
  await Setting.set('smtp_url', smtp_url || '');
  await Setting.set('smtp_noreply_address', smtp_noreply_address || '');
  await Setting.set('base_url', base_url || '');
  
  await req.flash('success', 'Settings saved successfully');
  return res.redirect('/settings');
});

module.exports = router;
