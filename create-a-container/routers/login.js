const express = require('express');
const router = express.Router();
const { User, Group, Site, Node, Setting } = require('../models');
const { isSafeRelativeUrl } = require('../utils');

const TEST_ENABLED = process.env.TEST_ENABLED === 'true';

// Test user definitions - one per group
const TEST_USERS = [
  {
    uid: 'test-sysadmin',
    givenName: 'Test',
    sn: 'Sysadmin',
    mail: 'test-sysadmin@example.com',
    userPassword: 'TestPassword123!',
    groupName: 'sysadmins',
    gidNumber: 2000
  },
  {
    uid: 'test-ldapuser',
    givenName: 'Test',
    sn: 'LdapUser',
    mail: 'test-ldapuser@example.com',
    userPassword: 'TestPassword123!',
    groupName: 'ldapusers',
    gidNumber: 2001
  }
];

// Test site and node configuration
const TEST_SITE = {
  name: 'Test Site',
  internalDomain: 'test.internal',
  dhcpRange: '10.0.0.100,10.0.0.200',
  subnetMask: '255.255.255.0',
  gateway: '10.0.0.1',
  dnsForwarders: '8.8.8.8,8.8.4.4'
};

const TEST_NODE = {
  name: 'test-node',
  ipv4Address: '10.0.0.10',
  apiUrl: 'https://mock-proxmox:8006',
  tokenId: 'test@pam!test-token',
  secret: 'mock-secret-not-used',
  tlsVerify: false,
  imageStorage: 'local'
};

/**
 * Ensure test site and node exist in the database
 */
async function ensureTestSiteAndNode() {
  if (!TEST_ENABLED) return;
  
  // Check if test site exists
  let site = await Site.findOne({ where: { name: TEST_SITE.name } });
  
  if (!site) {
    site = await Site.create(TEST_SITE);
    console.log('[TEST MODE] Created test site:', site.name);
  }
  
  // Check if test node exists for this site
  let node = await Node.findOne({ where: { name: TEST_NODE.name, siteId: site.id } });
  
  if (!node) {
    node = await Node.create({
      ...TEST_NODE,
      siteId: site.id
    });
    console.log('[TEST MODE] Created test node:', node.name);
  }
}

/**
 * Ensure test users exist in the database
 */
async function ensureTestUsers() {
  if (!TEST_ENABLED) return [];
  
  const testUsers = [];
  
  for (const testUser of TEST_USERS) {
    let user = await User.findOne({ where: { uid: testUser.uid } });
    
    if (!user) {
      // Create the test user
      const uidNumber = await User.nextUidNumber();
      user = await User.create({
        uidNumber,
        uid: testUser.uid,
        gidNumber: testUser.gidNumber,
        homeDirectory: `/home/${testUser.uid}`,
        loginShell: '/bin/bash',
        cn: `${testUser.givenName} ${testUser.sn}`,
        sn: testUser.sn,
        givenName: testUser.givenName,
        mail: testUser.mail,
        userPassword: testUser.userPassword,
        status: 'active'
      });
      
      // Add user to their designated group
      const group = await Group.findByPk(testUser.gidNumber);
      if (group) {
        await user.addGroup(group);
      }
    }
    
    testUsers.push({
      uid: testUser.uid,
      displayName: `${testUser.givenName} ${testUser.sn}`,
      groupName: testUser.groupName
    });
  }
  
  return testUsers;
}

// GET / - Display login form
router.get('/', async (req, res) => {
  let testUsers = [];
  if (TEST_ENABLED) {
    testUsers = await ensureTestUsers();
    await ensureTestSiteAndNode();
  }
  
  res.render('login', {
    successMessages: req.flash('success'),
    errorMessages: req.flash('error'),
    redirect: req.query.redirect || '/',
    testEnabled: TEST_ENABLED,
    testUsers
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

      // Check for no device found error
      if (result.success === false && result.error?.includes('No device found with this Username')) {
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

// POST /test-login - Handle test user quick login (only when TEST_ENABLED)
router.post('/test-login', async (req, res) => {
  if (!TEST_ENABLED) {
    await req.flash('error', 'Test login is not enabled');
    return res.redirect('/login');
  }

  const { testUser, redirect } = req.body;
  
  // Validate the test user is one of our allowed test users
  const allowedTestUser = TEST_USERS.find(u => u.uid === testUser);
  if (!allowedTestUser) {
    await req.flash('error', 'Invalid test user');
    return res.redirect('/login');
  }

  const user = await User.findOne({ 
    where: { uid: testUser },
    include: [{ association: 'groups' }]
  });

  if (!user) {
    await req.flash('error', 'Test user not found');
    return res.redirect('/login');
  }

  // Set session variables (skip password and 2FA for test users)
  req.session.user = user.uid;
  req.session.isAdmin = user.groups?.some(group => group.isAdmin) || false;

  let redirectUrl = redirect || '/';
  if (!isSafeRelativeUrl(redirectUrl)) {
    redirectUrl = '/';
  }

  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
    }
    return res.redirect(redirectUrl);
  });
});

module.exports = router;
