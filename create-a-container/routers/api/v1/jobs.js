/**
 * /api/v1/jobs — read job metadata + status rows + live SSE stream.
 * Job creation is intentionally not exposed: containers create their own jobs.
 */

const express = require('express');
const { Job, JobStatus, sequelize } = require('../../../models');
const { apiAuth, asyncHandler, ok, ApiError } = require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth);

async function authorizedJob(req) {
  const id = parseInt(req.params.id, 10);
  const job = await Job.findByPk(id);
  if (!job) throw new ApiError(404, 'not_found', 'Job not found');
  const isAdmin = req.session && req.session.isAdmin;
  if (!isAdmin && job.createdBy !== req.session.user) {
    throw new ApiError(404, 'not_found', 'Job not found');
  }
  return job;
}

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const job = await authorizedJob(req);
    return ok(res, {
      id: job.id,
      command: job.command,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      createdBy: job.createdBy,
    });
  }),
);

router.get(
  '/:id/status',
  asyncHandler(async (req, res) => {
    await authorizedJob(req);
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset, 10)) : 0;
    const limit = req.query.limit ? Math.min(1000, parseInt(req.query.limit, 10)) : 1000;
    const rows = await JobStatus.findAll({
      where: { jobId: req.params.id },
      order: [['createdAt', 'ASC']],
      limit,
      offset,
    });
    return ok(res, rows);
  }),
);

// SSE stream — re-uses the same authorization, body matches existing /jobs/:id/stream
router.get(
  '/:id/stream',
  asyncHandler(async (req, res) => {
    const job = await authorizedJob(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let lastId = req.query.lastId ? parseInt(req.query.lastId, 10) : 0;
    let isRunning = true;

    const keepalive = setInterval(() => {
      if (isRunning) res.write(':keepalive\n\n');
    }, 15000);

    const poll = setInterval(async () => {
      try {
        const newLogs = await JobStatus.findAll({
          where: {
            jobId: job.id,
            id: { [sequelize.Sequelize.Op.gt]: lastId },
          },
          order: [['id', 'ASC']],
          limit: 100,
        });
        for (const log of newLogs) {
          res.write(
            `event: log\ndata: ${JSON.stringify({
              id: log.id,
              output: log.output,
              timestamp: log.createdAt,
            })}\n\n`,
          );
          lastId = log.id;
        }
        const current = await Job.findByPk(job.id);
        if (!current || !['pending', 'running'].includes(current.status)) {
          res.write(
            `event: status\ndata: ${JSON.stringify({
              status: current ? current.status : 'unknown',
            })}\n\n`,
          );
          cleanup();
          res.end();
        }
      } catch (err) {
        console.error('SSE poll error:', err);
      }
    }, 2000);

    function cleanup() {
      isRunning = false;
      clearInterval(keepalive);
      clearInterval(poll);
    }
    req.on('close', cleanup);
  }),
);

module.exports = router;
