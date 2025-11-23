const express = require('express');
const router = express.Router();
const { User, Group } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

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

// GET /users/:id/edit - Display form for editing an existing user
router.get('/:id/edit', async (req, res) => {
  const uidNumber = parseInt(req.params.id, 10);
  
  const user = await User.findByPk(uidNumber, {
    include: [{ association: 'groups' }]
  });
  
  if (!user) {
    req.flash('error', 'User not found');
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
    const { uid, givenName, sn, mail, userPassword, status, groupIds } = req.body;
    
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

    req.flash('success', `User ${uid} created successfully`);
    return res.redirect('/users');
  } catch (error) {
    console.error('Error creating user:', error);
    req.flash('error', 'Failed to create user: ' + error.message);
    return res.redirect('/users/new');
  }
});

// PUT /users/:id - Update an existing user
router.put('/:id', async (req, res) => {
  const uidNumber = parseInt(req.params.id, 10);
  
  try {
    const user = await User.findByPk(uidNumber);
    
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/users');
    }

    const { uid, givenName, sn, mail, userPassword, status, groupIds } = req.body;
    
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

    req.flash('success', `User ${uid} updated successfully`);
    return res.redirect('/users');
  } catch (error) {
    console.error('Error updating user:', error);
    req.flash('error', 'Failed to update user: ' + error.message);
    return res.redirect(`/users/${uidNumber}/edit`);
  }
});

// DELETE /users/:id - Delete a user
router.delete('/:id', async (req, res) => {
  const uidNumber = parseInt(req.params.id, 10);
  
  try {
    const user = await User.findByPk(uidNumber);
    
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/users');
    }

    const username = user.uid;
    await user.destroy();
    
    req.flash('success', `User ${username} deleted successfully`);
    return res.redirect('/users');
  } catch (error) {
    console.error('Error deleting user:', error);
    req.flash('error', 'Failed to delete user: ' + error.message);
    return res.redirect('/users');
  }
});

module.exports = router;
