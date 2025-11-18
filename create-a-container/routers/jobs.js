const express = require('express');
const router = express.Router();
const { Job, JobStatus } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

// All job endpoints require authentication
router.use(requireAuth);

// POST /api/jobs - enqueue a new job (admins only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { command } = req.body;
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({ error: 'command is required' });
    }

    if (command.length > 2000) {
      return res.status(400).json({ error: 'command too long' });
    }

    const job = await Job.create({ command: command.trim() });
    return res.status(201).json({ id: job.id, status: job.status });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return res.status(500).json({ error: 'Failed to create job' });
  }
});

// GET /api/jobs/:id - job metadata
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const job = await Job.findByPk(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json({ id: job.id, command: job.command, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt });
  } catch (err) {
    console.error('Failed to fetch job:', err);
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// GET /api/jobs/:id/status - fetch job status rows
// Query params: sinceId (optional), limit (optional)
router.get('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sinceId = req.query.sinceId ? parseInt(req.query.sinceId, 10) : 0;
    const limit = req.query.limit ? Math.min(1000, parseInt(req.query.limit, 10)) : 1000;

    const rows = await JobStatus.findAll({
      where: Object.assign({ jobId: id }, sinceId ? { id: { [require('sequelize').Op.gt]: sinceId } } : {}),
      order: [['createdAt', 'ASC']],
      limit
    });

    return res.json(rows.map(r => ({ id: r.id, output: r.output, createdAt: r.createdAt })));
  } catch (err) {
    console.error('Failed to fetch job statuses:', err);
    return res.status(500).json({ error: 'Failed to fetch job statuses' });
  }
});

module.exports = router;
