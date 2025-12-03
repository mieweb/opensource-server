const express = require('express');
const router = express.Router();
const { Group, User } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

// Apply auth and admin check to all routes
router.use(requireAuth);
router.use(requireAdmin);

// GET /groups - List all groups
router.get('/', async (req, res) => {
  const groups = await Group.findAll({
    include: [{
      model: User,
      as: 'users',
      attributes: ['uidNumber', 'uid'],
      through: { attributes: [] }
    }],
    order: [['gidNumber', 'ASC']]
  });

  const rows = groups.map(g => ({
    gidNumber: g.gidNumber,
    cn: g.cn,
    isAdmin: g.isAdmin,
    userCount: g.users ? g.users.length : 0
  }));

  return res.render('groups/index', {
    rows,
    req
  });
});

// GET /groups/new - Display form for creating a new group
router.get('/new', async (req, res) => {
  res.render('groups/form', {
    group: null,
    isEdit: false,
    req
  });
});

// GET /groups/:id/edit - Display form for editing an existing group
router.get('/:id/edit', async (req, res) => {
  const group = await Group.findByPk(req.params.id);
  
  if (!group) {
    req.flash('error', 'Group not found');
    return res.redirect('/groups');
  }

  res.render('groups/form', {
    group,
    isEdit: true,
    req
  });
});

// POST /groups - Create a new group
router.post('/', async (req, res) => {
  try {
    const { gidNumber, cn, isAdmin } = req.body;
    
    await Group.create({
      gidNumber: parseInt(gidNumber),
      cn,
      isAdmin: isAdmin === 'on' || isAdmin === 'true'
    });

    req.flash('success', `Group ${cn} created successfully`);
    return res.redirect('/groups');
  } catch (error) {
    console.error('Error creating group:', error);
    req.flash('error', 'Failed to create group: ' + error.message);
    return res.redirect('/groups/new');
  }
});

// PUT /groups/:id - Update an existing group
router.put('/:id', async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    
    if (!group) {
      req.flash('error', 'Group not found');
      return res.redirect('/groups');
    }

    const { cn, isAdmin } = req.body;
    
    await group.update({
      cn,
      isAdmin: isAdmin === 'on' || isAdmin === 'true'
    });

    req.flash('success', `Group ${cn} updated successfully`);
    return res.redirect('/groups');
  } catch (error) {
    console.error('Error updating group:', error);
    req.flash('error', 'Failed to update group: ' + error.message);
    return res.redirect(`/groups/${req.params.id}/edit`);
  }
});

// DELETE /groups/:id - Delete a group
router.delete('/:id', async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    
    if (!group) {
      req.flash('error', 'Group not found');
      return res.redirect('/groups');
    }

    const groupName = group.cn;
    await group.destroy();

    req.flash('success', `Group ${groupName} deleted successfully`);
    return res.redirect('/groups');
  } catch (error) {
    console.error('Error deleting group:', error);
    req.flash('error', 'Failed to delete group: ' + error.message);
    return res.redirect('/groups');
  }
});

module.exports = router;
