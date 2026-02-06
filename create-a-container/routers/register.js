const express = require('express');
const router = express.Router();
const { User, InviteToken } = require('../models');

// GET / - Display registration form
router.get('/', async (req, res) => {
  const { token } = req.query;
  let inviteEmail = null;
  let validToken = null;
  
  // If token provided, validate it and extract email
  if (token) {
    const inviteToken = await InviteToken.validateToken(token);
    if (inviteToken) {
      inviteEmail = inviteToken.email;
      validToken = token;
    } else {
      await req.flash('error', 'Invalid or expired invitation link. Please request a new invitation.');
    }
  }
  
  res.render('register', {
    successMessages: req.flash('success'),
    errorMessages: req.flash('error'),
    inviteEmail,
    inviteToken: validToken
  });
});

// POST / - Handle registration submission
router.post('/', async (req, res) => {
  const { inviteToken } = req.body;
  let isInvitedUser = false;
  let validatedInvite = null;
  
  // If invite token provided, validate it matches the email
  if (inviteToken) {
    validatedInvite = await InviteToken.validateToken(inviteToken);
    if (!validatedInvite) {
      await req.flash('error', 'Invalid or expired invitation link. Please request a new invitation.');
      return res.redirect('/register');
    }
    
    // Ensure email matches the invite
    const submittedEmail = req.body.mail.toLowerCase().trim();
    if (submittedEmail !== validatedInvite.email) {
      await req.flash('error', 'Email address does not match the invitation.');
      return res.redirect(`/register?token=${inviteToken}`);
    }
    
    isInvitedUser = true;
  }
  
  // Determine user status
  let status;
  if (await User.count() === 0) {
    status = 'active'; // First user is always active
  } else if (isInvitedUser) {
    status = 'active'; // Invited users are auto-activated
  } else {
    status = 'pending'; // Regular registrations are pending
  }
  
  const userParams = {
    uidNumber: await User.nextUidNumber(),
    uid: req.body.uid,
    sn: req.body.sn,
    givenName: req.body.givenName,
    mail: req.body.mail,
    userPassword: req.body.userPassword,
    status,
    cn: `${req.body.givenName} ${req.body.sn}`,
    homeDirectory: `/home/${req.body.uid}`,
  };

  try {
    await User.create(userParams);
    
    // Mark invite token as used
    if (validatedInvite) {
      await validatedInvite.markAsUsed();
    }
    
    if (isInvitedUser) {
      await req.flash('success', 'Account created successfully! You can now log in.');
    } else {
      await req.flash('success', 'Account registered successfully. You will be notified via email once approved.');
    }
    return res.redirect('/login');
  } catch (err) {
    console.error('Registration error:', err);
    
    // Handle Sequelize unique constraint errors with user-friendly messages
    if (err.name === 'SequelizeUniqueConstraintError' && err.errors && err.errors.length > 0) {
      const field = err.errors[0]?.path;
      if (field === 'uid') {
        await req.flash('error', 'This username is already registered. Please choose a different username or login with your existing account.');
      } else if (field === 'mail') {
        await req.flash('error', 'This email address is already registered. Please use a different email or login with your existing account.');
      } else {
        await req.flash('error', 'A user with these details is already registered. Please login with your existing account.');
      }
    } else {
      await req.flash('error', 'Registration failed: ' + err.message);
    }
    
    // Preserve invite token in redirect if present
    const redirectUrl = inviteToken ? `/register?token=${inviteToken}` : '/register';
    return res.redirect(redirectUrl);
  }
});

module.exports = router;
