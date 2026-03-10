const express = require('express');
const router = express.Router();
const { CustomTool, Group } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

router.use(requireAuth);
router.use(requireAdmin);

// GET /custom-tools
router.get('/', async (req, res) => {
  const tools = await CustomTool.findAll({
    include: [{ model: Group, as: 'visibleToGroups', attributes: ['gidNumber', 'cn'] }],
    order: [['name', 'ASC']]
  });
  const groups = await Group.findAll({ order: [['cn', 'ASC']] });

  res.render('custom-tools/index', { tools, groups, req });
});

// POST /custom-tools
router.post('/', async (req, res) => {
  const { name, url, groupIds } = req.body;

  if (!name || !name.trim()) {
    await req.flash('error', 'Tool name is required');
    return res.redirect('/custom-tools');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http and https URLs are allowed');
    }
  } catch {
    await req.flash('error', 'A valid http or https URL is required');
    return res.redirect('/custom-tools');
  }

  const tool = await CustomTool.create({ name: name.trim(), url: parsedUrl.toString() });

  const ids = [].concat(groupIds || []).map(id => parseInt(id, 10)).filter(Boolean);
  if (ids.length > 0) {
    const groups = await Group.findAll({ where: { gidNumber: ids } });
    await tool.setVisibleToGroups(groups);
  }

  await req.flash('success', `Custom tool "${tool.name}" created`);
  return res.redirect('/custom-tools');
});

// POST /custom-tools/:id/delete  (method-override DELETE)
router.delete('/:id', async (req, res) => {
  const tool = await CustomTool.findByPk(parseInt(req.params.id, 10));
  if (!tool) {
    await req.flash('error', 'Tool not found');
    return res.redirect('/custom-tools');
  }
  await tool.destroy();
  await req.flash('success', `Custom tool "${tool.name}" deleted`);
  return res.redirect('/custom-tools');
});

// PUT /custom-tools/:id
router.put('/:id', async (req, res) => {
  const tool = await CustomTool.findByPk(parseInt(req.params.id, 10));
  if (!tool) {
    await req.flash('error', 'Tool not found');
    return res.redirect('/custom-tools');
  }

  const { name, url, groupIds } = req.body;

  if (!name || !name.trim()) {
    await req.flash('error', 'Tool name is required');
    return res.redirect('/custom-tools');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http and https URLs are allowed');
    }
  } catch {
    await req.flash('error', 'A valid http or https URL is required');
    return res.redirect('/custom-tools');
  }

  await tool.update({ name: name.trim(), url: parsedUrl.toString() });

  const ids = [].concat(groupIds || []).map(id => parseInt(id, 10)).filter(Boolean);
  const groups = ids.length > 0 ? await Group.findAll({ where: { gidNumber: ids } }) : [];
  await tool.setVisibleToGroups(groups);

  await req.flash('success', `Custom tool "${tool.name}" updated`);
  return res.redirect('/custom-tools');
});

module.exports = router;
