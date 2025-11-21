const express = require('express');
const router = express.Router();
const { User } = require('../models');

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

  // Set session variables
  req.session.user = user.uid;
  req.session.isAdmin = user.groups?.some(group => group.isAdmin) || false;
  return res.redirect(req.body.redirect || '/');
});

module.exports = router;
