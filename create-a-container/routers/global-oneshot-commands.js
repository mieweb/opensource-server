const express = require('express');
const router = express.Router();
const { GlobalOneShotCommand } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

router.use(requireAuth);
router.use(requireAdmin);

// GET /global-oneshot-commands
router.get('/', async (req, res) => {
  const commands = await GlobalOneShotCommand.findAll({ order: [['name', 'ASC']] });
  res.render('global-oneshot-commands/index', { commands, req });
});

// POST /global-oneshot-commands
router.post('/', async (req, res) => {
  const { name, command, enabled } = req.body;

  if (!name || !name.trim()) {
    await req.flash('error', 'Command name is required');
    return res.redirect('/global-oneshot-commands');
  }
  if (!command || !command.trim()) {
    await req.flash('error', 'Command is required');
    return res.redirect('/global-oneshot-commands');
  }

  await GlobalOneShotCommand.create({
    name: name.trim(),
    command: command.trim(),
    enabled: enabled === 'on'
  });

  await req.flash('success', 'Global one-shot command created');
  return res.redirect('/global-oneshot-commands');
});

// PUT /global-oneshot-commands/:id
router.put('/:id', async (req, res) => {
  const cmd = await GlobalOneShotCommand.findByPk(parseInt(req.params.id, 10));
  if (!cmd) {
    await req.flash('error', 'Command not found');
    return res.redirect('/global-oneshot-commands');
  }

  const { name, command, enabled } = req.body;

  if (!name || !name.trim()) {
    await req.flash('error', 'Command name is required');
    return res.redirect('/global-oneshot-commands');
  }
  if (!command || !command.trim()) {
    await req.flash('error', 'Command is required');
    return res.redirect('/global-oneshot-commands');
  }

  await cmd.update({
    name: name.trim(),
    command: command.trim(),
    enabled: enabled === 'on'
  });

  await req.flash('success', 'Global one-shot command updated');
  return res.redirect('/global-oneshot-commands');
});

// DELETE /global-oneshot-commands/:id
router.delete('/:id', async (req, res) => {
  const cmd = await GlobalOneShotCommand.findByPk(parseInt(req.params.id, 10));
  if (!cmd) {
    await req.flash('error', 'Command not found');
    return res.redirect('/global-oneshot-commands');
  }
  await cmd.destroy();
  await req.flash('success', `Command "${cmd.name}" deleted`);
  return res.redirect('/global-oneshot-commands');
});

module.exports = router;
