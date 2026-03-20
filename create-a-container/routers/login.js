const express = require('express');
const router = express.Router();
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

// GET / - Display login form
router.get('/', async (req, res) => {
  const userCount = await User.count();
  const devMode = isDevMode();
  res.render('login', {
    successMessages: req.flash('success'),
    errorMessages: req.flash('error'),
    warningMessages: req.flash('warning'),
    redirect: req.query.redirect || '/',
    noUsers: userCount === 0,
    showQuickLogin: devMode
  });
});

// POST /quick - Create test user and auto-login (dev mode only)
router.post('/quick', async (req, res) => {
  // Only allow in dev mode
  if (!isDevMode()) {
    await req.flash('error', 'Quick login is only available in development mode');
    return res.redirect('/login');
  }
  
  const role = req.body.role || 'admin';
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
    req.session.user = user.uid;
    req.session.isAdmin = userIsAdmin;
    
    // Save session and redirect to app
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
      }
      return res.redirect('/');
    });
  } catch (err) {
    console.error('Quick login error:', err);
    await req.flash('error', 'Failed to create user: ' + err.message);
    return res.redirect('/login');
  }
});

// POST / - Handle login submission
router.post('/', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ 
    where: { uid: username },
    include: [{ association: 'groups' }]
  });
  if (!user) {
    await req.flash('error', 'Invalid username or password');
    return res.redirect('/login');
  }

  const isValidPassword = await user.validatePassword(password);
  if (!isValidPassword) {
    await req.flash('error', 'Invalid username or password');
    return res.redirect('/login');
  }

  if (user.status !== 'active') {
    await req.flash('error', 'Account is not active. Please contact the administrator.');
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

      // Check for user not registered errors
      if (result.success === false &&
          (result.error?.includes('No device found with this Username') ||
           result.error?.includes('User not found'))) {
        const registrationUrl = pushNotificationUrl;
        await req.flash('error', `No device found with this username. Please register your device at: <a href="${registrationUrl}" target="_blank" rel="noopener noreferrer" style="color: #721c24; text-decoration: underline;">${registrationUrl}</a>`);
        return res.redirect('/login');
      }

      if (!response.ok) {
        await req.flash('error', 'Failed to send push notification. Please contact support.');
        return res.redirect('/login');
      }

      if (result.action !== 'approve') {
        // Distinguish between different failure scenarios
        if (result.action === 'reject') {
          await req.flash('error', 'Second factor push notification was denied.');
        } else if (result.action === 'timeout') {
          await req.flash('error', 'Second factor push notification timed out. Please try again.');
        } else {
          await req.flash('error', `Second factor push notification failed: ${result.action}. Please contact support.`);
        }
        return res.redirect('/login');
      }
    } catch (error) {
      console.error('Push notification error:', error);
      await req.flash('error', 'Failed to send push notification. Please contact support.');
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
  
  // Save session before redirect to ensure it's persisted
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
    }
    return res.redirect(redirectUrl);
  });
});

module.exports = router;
