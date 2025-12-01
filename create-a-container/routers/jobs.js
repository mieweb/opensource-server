const express = require('express');
const router = express.Router();
const { Job, JobStatus, sequelize } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

// All job endpoints require authentication
router.use(requireAuth);

// POST /jobs - enqueue a new job (admins only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { command } = req.body;
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({ error: 'command is required' });
    }

    if (command.length > 2000) {
      return res.status(400).json({ error: 'command too long' });
    }

    // Set job owner to the authenticated username from session
    const owner = req.session && req.session.user ? req.session.user : null;
    const job = await Job.create({ command: command.trim(), createdBy: owner });
    return res.status(201).json({ id: job.id, status: job.status });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return res.status(500).json({ error: 'Failed to create job' });
  }
});

// GET /jobs/:id - job metadata
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const job = await Job.findByPk(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Authorization: only owner or admin can view
    const username = req.session && req.session.user;
    const isAdmin = req.session && req.session.isAdmin;
    if (!isAdmin && job.createdBy !== username) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json({ id: job.id, command: job.command, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, createdBy: job.createdBy });
  } catch (err) {
    console.error('Failed to fetch job:', err);
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// GET /jobs/:id/status - fetch job status rows
// Query params: sinceId (optional), limit (optional)
router.get('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Offset/limit pagination: supply `offset` and `limit` for paging.
    // `offset` defaults to 0. `limit` is capped at 1000.
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset, 10)) : 0;
    const limit = req.query.limit ? Math.min(1000, parseInt(req.query.limit, 10)) : 1000;

    const where = { jobId: id };
    const findOpts = { where, order: [['createdAt', 'ASC']], limit, offset };

    // Ensure only owner or admin can fetch statuses
    const job = await Job.findByPk(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const username = req.session && req.session.user;
    const isAdmin = req.session && req.session.isAdmin;
    if (!isAdmin && job.createdBy !== username) {
      // Hide existence to prevent information leakage
      return res.status(404).json({ error: 'Job not found' });
    }

    const rows = await JobStatus.findAll(findOpts);

    return res.json(rows);
  } catch (err) {
    console.error('Failed to fetch job statuses:', err);
    return res.status(500).json({ error: 'Failed to fetch job statuses' });
  }
});

module.exports = router;
