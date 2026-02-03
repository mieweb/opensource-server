const express = require('express');
const router = express.Router();
const { User, PasswordResetToken } = require('../models');
const { sendPasswordResetEmail } = require('../utils/email');

// GET /reset-password - Display the form to request password reset
router.get('/', (req, res) => {
  res.render('reset-password/request', {
    successMessages: req.flash('success'),
    errorMessages: req.flash('error')
  });
});

// POST /reset-password - Handle password reset request
router.post('/', async (req, res) => {
  const { usernameOrEmail } = req.body;
  
  if (!usernameOrEmail || usernameOrEmail.trim() === '') {
    await req.flash('error', 'Please enter your username or email address');
    return res.redirect('/reset-password');
  }
  
  try {
    // Look up user by username or email
    const user = await User.findOne({
      where: {
        [require('sequelize').Op.or]: [
          { uid: usernameOrEmail.trim() },
          { mail: usernameOrEmail.trim() }
        ]
      }
    });
    
    if (!user) {
      await req.flash('error', 'User not found');
      return res.redirect('/reset-password');
    }
    
    // Generate reset token
    const { token } = await PasswordResetToken.generateToken(user.uidNumber);
    
    // Build reset URL
    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
    
    // Send email
    try {
      await sendPasswordResetEmail(user.mail, user.uid, resetUrl);
      await req.flash('success', 'Password reset instructions have been sent to your email address');
      return res.redirect('/login');
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
      await req.flash('error', 'Password reset failed, please contact an administrator');
      return res.redirect('/reset-password');
    }
  } catch (error) {
    console.error('Password reset error:', error);
    await req.flash('error', 'Password reset failed, please contact an administrator');
    return res.redirect('/reset-password');
  }
});

// GET /reset-password/:token - Display password reset form with token
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  
  try {
    const resetToken = await PasswordResetToken.validateToken(token);
    
    if (!resetToken) {
      await req.flash('error', 'Invalid or expired password reset link');
      return res.redirect('/login');
    }
    
    res.render('reset-password/reset', {
      token,
      username: resetToken.user.uid,
      successMessages: req.flash('success'),
      errorMessages: req.flash('error')
    });
  } catch (error) {
    console.error('Password reset token validation error:', error);
    await req.flash('error', 'Password reset failed, please contact an administrator');
    return res.redirect('/login');
  }
});

// POST /reset-password/:token - Handle password reset
router.post('/:token', async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;
  
  // Validate passwords
  if (!password || !confirmPassword) {
    await req.flash('error', 'Please enter and confirm your new password');
    return res.redirect(`/reset-password/${token}`);
  }
  
  if (password !== confirmPassword) {
    await req.flash('error', 'Passwords do not match');
    return res.redirect(`/reset-password/${token}`);
  }
  
  if (password.length < 8) {
    await req.flash('error', 'Password must be at least 8 characters long');
    return res.redirect(`/reset-password/${token}`);
  }
  
  try {
    const resetToken = await PasswordResetToken.validateToken(token);
    
    if (!resetToken) {
      await req.flash('error', 'Invalid or expired password reset link');
      return res.redirect('/login');
    }
    
    const user = resetToken.user;
    
    // Update password (User model should handle hashing)
    await user.setPassword(password);
    
    // Mark token as used
    await resetToken.markAsUsed();
    
    await req.flash('success', 'Your password has been reset successfully. Please log in with your new password.');
    return res.redirect('/login');
  } catch (error) {
    console.error('Password reset error:', error);
    await req.flash('error', 'Password reset failed, please contact an administrator');
    return res.redirect(`/reset-password/${token}`);
  }
});

module.exports = router;
