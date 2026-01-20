const express = require('express');
const router = express.Router();
const { Setting } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

router.use(requireAuth);
router.use(requireAdmin);

router.get('/', async (req, res) => {
  const settings = await Setting.getMultiple(['push_notification_url', 'push_notification_enabled']);
  
  res.render('settings/index', {
    pushNotificationUrl: settings.push_notification_url || '',
    pushNotificationEnabled: settings.push_notification_enabled === 'true',
    req
  });
});

router.post('/', async (req, res) => {
  const { push_notification_url, push_notification_enabled } = req.body;
  
  const enabled = push_notification_enabled === 'on';
  
  if (enabled && (!push_notification_url || push_notification_url.trim() === '')) {
    req.flash('error', 'Push notification URL is required when push notifications are enabled');
    return res.redirect('/settings');
  }
  
  await Setting.set('push_notification_url', push_notification_url || '');
  await Setting.set('push_notification_enabled', enabled ? 'true' : 'false');
  
  req.flash('success', 'Settings saved successfully');
  return res.redirect('/settings');
});

module.exports = router;
