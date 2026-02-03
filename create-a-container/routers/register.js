const express = require('express');
const router = express.Router();
const { User } = require('../models');

// GET / - Display registration form
router.get('/', (req, res) => {
  res.render('register', {
    successMessages: req.flash('success'),
    errorMessages: req.flash('error')
  });
});

// POST / - Handle registration submission
router.post('/', async (req, res) => {
  const userParams = {
    uidNumber: await User.nextUidNumber(),
    uid: req.body.uid,
    sn: req.body.sn,
    givenName: req.body.givenName,
    mail: req.body.mail,
    userPassword: req.body.userPassword,
    status: await User.count() === 0 ? 'active' : 'pending', // first user is active
    cn: `${req.body.givenName} ${req.body.sn}`,
    homeDirectory: `/home/${req.body.uid}`,
  };

  try {
    await User.create(userParams);
    req.flash('success', 'Account registered successfully. You will be notified via email once approved.');
    return res.redirect('/login');
  } catch (err) {
    console.error('Registration error:', err);
    
    // Handle Sequelize unique constraint errors with user-friendly messages
    if (err.name === 'SequelizeUniqueConstraintError' && err.errors && err.errors.length > 0) {
      const field = err.errors[0]?.path;
      if (field === 'uid') {
        req.flash('error', 'This username is already registered. Please choose a different username or login with your existing account.');
      } else if (field === 'mail') {
        req.flash('error', 'This email address is already registered. Please use a different email or login with your existing account.');
      } else {
        req.flash('error', 'A user with these details is already registered. Please login with your existing account.');
      }
    } else {
      req.flash('error', 'Registration failed: ' + err.message);
    }
    return res.redirect('/register');
  }
});

module.exports = router;
