const express = require('express');
const router = express.Router();
const { Job, JobStatus, Container, Node, sequelize } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');

// All job endpoints require authentication
router.use(requireAuth);

/**
 * Helper to check if user can access a job
 */
async function canAccessJob(job, req) {
  const username = req.session && req.session.user;
  const isAdmin = req.session && req.session.isAdmin;
  return isAdmin || job.createdBy === username;
}

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

// GET /jobs/:id - job metadata (HTML or JSON based on Accept header)
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const job = await Job.findByPk(id);
    if (!job) {
      if (req.accepts('html')) {
        req.flash('error', 'Job not found');
        return res.redirect('/');
      }
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Authorization: only owner or admin can view
    if (!await canAccessJob(job, req)) {
      if (req.accepts('html')) {
        req.flash('error', 'Job not found');
        return res.redirect('/');
      }
      return res.status(404).json({ error: 'Job not found' });
    }

    // If client accepts HTML, render the job view
    if (req.accepts('html')) {
      // Get initial output for completed jobs or first batch for running jobs
      const initialOutput = await JobStatus.findAll({
        where: { jobId: id },
        order: [['id', 'ASC']],
        limit: 1000
      });
      
      // Find the container associated with this job (if any)
      const container = await Container.findOne({
        where: { creationJobId: id },
        include: [{ model: Node, as: 'node' }]
      });
      
      return res.render('jobs/show', {
        job,
        initialOutput,
        container,
        req
      });
    }

    // JSON response for API clients
    return res.json({ 
      id: job.id, 
      command: job.command, 
      status: job.status, 
      createdAt: job.createdAt, 
      updatedAt: job.updatedAt, 
      createdBy: job.createdBy 
    });
  } catch (err) {
    console.error('Failed to fetch job:', err);
    if (req.accepts('html')) {
      req.flash('error', 'Failed to load job');
      return res.redirect('/');
    }
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// GET /jobs/:id/stream - SSE endpoint for streaming job output
router.get('/:id/stream', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  
  try {
    const job = await Job.findByPk(id);
    if (!job || !await canAccessJob(job, req)) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();
    
    // Track last sent ID for incremental updates
    let lastId = req.query.lastId ? parseInt(req.query.lastId, 10) : 0;
    let isRunning = true;
    
    // Send keepalive every 15 seconds
    const keepaliveInterval = setInterval(() => {
      if (isRunning) {
        res.write(':keepalive\n\n');
      }
    }, 15000);
    
    // Poll for new output every 2 seconds
    const pollInterval = setInterval(async () => {
      try {
        // Fetch new log entries
        const newLogs = await JobStatus.findAll({
          where: {
            jobId: id,
            id: { [sequelize.Sequelize.Op.gt]: lastId }
          },
          order: [['id', 'ASC']],
          limit: 100
        });
        
        // Send each new log entry
        for (const log of newLogs) {
          res.write(`event: log\ndata: ${JSON.stringify({ id: log.id, output: log.output, timestamp: log.createdAt })}\n\n`);
          lastId = log.id;
        }
        
        // Check if job is still running
        const currentJob = await Job.findByPk(id);
        if (!currentJob || !['pending', 'running'].includes(currentJob.status)) {
          // Send final status and close
          res.write(`event: status\ndata: ${JSON.stringify({ status: currentJob ? currentJob.status : 'unknown' })}\n\n`);
          cleanup();
          res.end();
        }
      } catch (err) {
        console.error('SSE poll error:', err);
      }
    }, 2000);
    
    function cleanup() {
      isRunning = false;
      clearInterval(keepaliveInterval);
      clearInterval(pollInterval);
    }
    
    // Clean up on client disconnect
    req.on('close', cleanup);
    
  } catch (err) {
    console.error('SSE setup error:', err);
    res.status(500).json({ error: 'Failed to start stream' });
  }
});

// GET /jobs/:id/status - fetch job status rows
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
    if (!job || !await canAccessJob(job, req)) {
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
