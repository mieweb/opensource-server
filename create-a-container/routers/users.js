const express = require('express');
const router = express.Router();
const { User, Group, InviteToken, Setting } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');
const { sendInviteEmail, sendBulkEmail } = require('../utils/email');
const { sendPushNotificationInvite } = require('../utils/push-notification-invite');
const { formatSequelizeError } = require('../utils');

// Apply auth and admin check to all routes
router.use(requireAuth);
router.use(requireAdmin);

// GET /users - List all users
router.get('/', async (req, res) => {
  const users = await User.findAll({
    include: [{ 
      association: 'groups',
      attributes: ['gidNumber', 'cn', 'isAdmin']
    }],
    order: [['uidNumber', 'ASC']]
  });

  const rows = users.map(u => ({
    uidNumber: u.uidNumber,
    uid: u.uid,
    cn: u.cn,
    mail: u.mail,
    status: u.status,
    groups: u.groups ? u.groups.map(g => g.cn).join(', ') : '',
    isAdmin: u.groups?.some(g => g.isAdmin) || false
  }));

  return res.render('users/index', {
    rows,
    req
  });
});

// GET /users/new - Display form for creating a new user
router.get('/new', async (req, res) => {
  const groups = await Group.findAll({
    order: [['gidNumber', 'ASC']]
  });

  res.render('users/form', {
    user: null,
    groups,
    isEdit: false,
    req
  });
});

// GET /users/invite - Display form for inviting a user via email
router.get('/invite', async (req, res) => {
  res.render('users/invite', {
    req
  });
});

// POST /users/email-all - Send an email to all users with an email address
router.post('/email-all', async (req, res) => {
  const { subject, message } = req.body;

  if (!subject || subject.trim() === '' || !message || message.trim() === '') {
    await req.flash('error', 'Both Subject and Message are required');
    return res.redirect('/users');
  }

  try {
    // Verify SMTP is configured before attempting to send
    const settings = await Setting.getMultiple(['smtp_url']);
    if (!settings.smtp_url || settings.smtp_url.trim() === '') {
      await req.flash('error', 'SMTP is not configured. Please configure SMTP settings before sending email.');
      return res.redirect('/users');
    }

    // Collect unique, non-empty email addresses across all users
    const users = await User.findAll({ attributes: ['mail'] });
    const recipients = [...new Set(
      users
        .map(u => (u.mail || '').trim().toLowerCase())
        .filter(m => m.length > 0)
    )];

    if (recipients.length === 0) {
      await req.flash('error', 'No users with email addresses to send to');
      return res.redirect('/users');
    }

    const { sent, failed } = await sendBulkEmail(recipients, subject.trim(), message);

    if (failed.length === 0) {
      await req.flash('success', `Email sent to ${sent.length} user${sent.length === 1 ? '' : 's'}`);
    } else if (sent.length === 0) {
      console.error('Bulk email failures:', failed);
      await req.flash('error', `Failed to send email to all ${failed.length} recipient${failed.length === 1 ? '' : 's'}. Check SMTP settings.`);
    } else {
      console.error('Bulk email partial failures:', failed);
      await req.flash('warning', `Email sent to ${sent.length} user${sent.length === 1 ? '' : 's'}; failed for ${failed.length}.`);
    }
    return res.redirect('/users');
  } catch (error) {
    console.error('Email all error:', error);
    await req.flash('error', 'Failed to send email: ' + error.message);
    return res.redirect('/users');
  }
});

// POST /users/invite - Send invitation email
router.post('/invite', async (req, res) => {
  const { email } = req.body;
  
  if (!email || email.trim() === '') {
    await req.flash('error', 'Please enter an email address');
    return res.redirect('/users/invite');
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  
  try {
    // Check if SMTP is configured
    const settings = await Setting.getMultiple(['smtp_url']);
    if (!settings.smtp_url || settings.smtp_url.trim() === '') {
      await req.flash('error', 'SMTP is not configured. Please configure SMTP settings before sending invitations.');
      return res.redirect('/users/invite');
    }
    
    // Check if email is already registered
    const existingUser = await User.findOne({ where: { mail: normalizedEmail } });
    if (existingUser) {
      await req.flash('error', 'A user with this email address is already registered');
      return res.redirect('/users/invite');
    }
    
    // Generate invite token (24-hour expiry)
    const { token } = await InviteToken.generateToken(normalizedEmail, 24);
    
    // Build invite URL
    const inviteUrl = `${req.protocol}://${req.get('host')}/register?token=${token}`;
    
    // Send invite email
    try {
      await sendInviteEmail(normalizedEmail, inviteUrl);
      await req.flash('success', `Invitation sent to ${normalizedEmail}`);
      return res.redirect('/users');
    } catch (emailError) {
      console.error('Failed to send invite email:', emailError);
      await req.flash('error', 'Failed to send invitation email. Please check SMTP settings.');
      return res.redirect('/users/invite');
    }
  } catch (error) {
    console.error('Invite error:', error);
    await req.flash('error', 'Failed to send invitation: ' + formatSequelizeError(error));
    return res.redirect('/users/invite');
  }
});

// GET /users/:id/edit - Display form for editing an existing user
router.get('/:id/edit', async (req, res) => {
  const uidNumber = parseInt(req.params.id, 10);
  
  const user = await User.findByPk(uidNumber, {
    include: [{ association: 'groups' }]
  });
  
  if (!user) {
    await req.flash('error', 'User not found');
    return res.redirect('/users');
  }

  const groups = await Group.findAll({
    order: [['gidNumber', 'ASC']]
  });

  res.render('users/form', {
    user,
    groups,
    isEdit: true,
    req
  });
});

// POST /users - Create a new user
router.post('/', async (req, res) => {
  try {
    const { uid, givenName: rawGivenName, sn: rawSn, mail, userPassword, status, groupIds } = req.body;
    
    const givenName = rawGivenName.trim();
    const sn = rawSn.trim();
    
    const user = await User.create({
      uidNumber: await User.nextUidNumber(),
      uid,
      givenName,
      sn,
      cn: `${givenName} ${sn}`,
      mail,
      userPassword,
      status: status || 'pending',
      homeDirectory: `/home/${uid}`,
      loginShell: '/bin/bash',
      gidNumber: 2001 // ldapusers as primary group
    });

    // Add user to selected groups
    if (groupIds) {
      const gids = Array.isArray(groupIds) ? groupIds : [groupIds];
      const groups = await Group.findAll({
        where: { gidNumber: gids }
      });
      await user.setGroups(groups);
    }

    await req.flash('success', `User ${uid} created successfully`);
    return res.redirect('/users');
  } catch (error) {
    console.error('Error creating user:', error);
    await req.flash('error', 'Failed to create user: ' + formatSequelizeError(error));
    return res.redirect('/users/new');
  }
});

// PUT /users/:id - Update an existing user
router.put('/:id', async (req, res) => {
  const uidNumber = parseInt(req.params.id, 10);
  
  try {
    const user = await User.findByPk(uidNumber);
    
    if (!user) {
      await req.flash('error', 'User not found');
      return res.redirect('/users');
    }

    const { uid, givenName: rawGivenName, sn: rawSn, mail, userPassword, status, groupIds } = req.body;
    
    const givenName = rawGivenName.trim();
    const sn = rawSn.trim();
    
    const previousStatus = user.status;
    
    // Update user fields
    user.uid = uid;
    user.givenName = givenName;
    user.sn = sn;
    user.cn = `${givenName} ${sn}`;
    user.mail = mail;
    user.status = status || 'pending';
    user.homeDirectory = `/home/${uid}`;
    
    // Only update password if provided
    if (userPassword && userPassword.trim() !== '') {
      user.userPassword = userPassword;
    }
    
    await user.save();

    // Send 2FA invite when user is first approved (pending → active)
    // Returns null when not configured — skip silently
    if (previousStatus !== 'active' && user.status === 'active') {
      const inviteResult = await sendPushNotificationInvite(user);
      if (inviteResult && !inviteResult.success) {
        await req.flash('warning', `User approved but 2FA invite failed: ${inviteResult.error}`);
      }
    }

    // Update groups
    if (groupIds) {
      const gids = Array.isArray(groupIds) ? groupIds : [groupIds];
      const groups = await Group.findAll({
        where: { gidNumber: gids }
      });
      await user.setGroups(groups);
    } else {
      // If no groups selected, clear all groups
      await user.setGroups([]);
    }

    await req.flash('success', `User ${uid} updated successfully`);
    return res.redirect('/users');
  } catch (error) {
    console.error('Error updating user:', error);
    await req.flash('error', 'Failed to update user: ' + formatSequelizeError(error));
    return res.redirect(`/users/${uidNumber}/edit`);
  }
});

// DELETE /users/:id - Delete a user
router.delete('/:id', async (req, res) => {
  const uidNumber = parseInt(req.params.id, 10);
  
  try {
    const user = await User.findByPk(uidNumber);
    
    if (!user) {
      await req.flash('error', 'User not found');
      return res.redirect('/users');
    }

    const username = user.uid;
    await user.destroy();
    
    await req.flash('success', `User ${username} deleted successfully`);
    return res.redirect('/users');
  } catch (error) {
    console.error('Error deleting user:', error);
    await req.flash('error', 'Failed to delete user: ' + formatSequelizeError(error));
    return res.redirect('/users');
  }
});

module.exports = router;
