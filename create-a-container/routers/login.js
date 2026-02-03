const express = require('express');
const router = express.Router();
const { User, Setting } = require('../models');
const { isSafeRelativeUrl } = require('../utils');

// GET / - Display login form
router.get('/', (req, res) => {
  res.render('login', {
    successMessages: req.flash('success'),
    errorMessages: req.flash('error'),
    redirect: req.query.redirect || '/'
  });
});

// POST / - Handle login submission
router.post('/', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ 
    where: { uid: username },
    include: [{ association: 'groups' }]
  });
  if (!user) {
    req.flash('error', 'Invalid username or password');
    return res.redirect('/login');
  }

  const isValidPassword = await user.validatePassword(password);
  if (!isValidPassword) {
    req.flash('error', 'Invalid username or password');
    return res.redirect('/login');
  }

  if (user.status !== 'active') {
    req.flash('error', 'Account is not active. Please contact the administrator.');
    return res.redirect('/login');
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
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(notificationPayload)
      });

      const result = await response.json();

      // Check for no device found error
      if (result.success === false && result.error?.includes('No device found with this Username')) {
        const registrationUrl = pushNotificationUrl;
        req.flash('error', `No device found with this username. Please register your device at: <a href="${registrationUrl}" target="_blank" rel="noopener noreferrer" style="color: #721c24; text-decoration: underline;">${registrationUrl}</a>`);
        return res.redirect('/login');
      }

      if (!response.ok) {
        req.flash('error', 'Failed to send push notification. Please contact support.');
        return res.redirect('/login');
      }

      if (result.action !== 'approve') {
        // Distinguish between different failure scenarios
        if (result.action === 'reject') {
          req.flash('error', 'Second factor push notification was denied.');
        } else if (result.action === 'timeout') {
          req.flash('error', 'Second factor push notification timed out. Please try again.');
        } else {
          req.flash('error', `Second factor push notification failed: ${result.action}. Please contact support.`);
        }
        return res.redirect('/login');
      }
    } catch (error) {
      console.error('Push notification error:', error);
      req.flash('error', 'Failed to send push notification. Please contact support.');
      return res.redirect('/login');
    }
  }

  // Set session variables
  req.session.user = user.uid;
  req.session.isAdmin = user.groups?.some(group => group.isAdmin) || false;

  // Return redirect to original page or default to home
  let redirectUrl = req.body.redirect || '/';
  if (!isSafeRelativeUrl(redirectUrl)) {
    // ensure redirect is a relative path
    redirectUrl = '/';
  }
  return res.redirect(redirectUrl);
});

module.exports = router;
