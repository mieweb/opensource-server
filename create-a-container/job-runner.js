#!/usr/bin/env node
/**
 * job-runner.js
 * - Polls the Jobs table for pending jobs
 * - Claims a job (transactionally), sets status to 'running'
 * - Spawns the configured command and streams stdout/stderr into JobStatuses
 * - Marks job success/failure on exit
 */

const { spawn } = require('child_process');
const path = require('path');
const db = require('./models');

const POLL_INTERVAL_MS = parseInt(process.env.JOB_RUNNER_POLL_MS || '2000', 10);
const WORKDIR = process.env.JOB_RUNNER_CWD || process.cwd();

let shuttingDown = false;

async function claimPendingJob() {
  const sequelize = db.sequelize;
  const t = await sequelize.transaction();
  try {
    const job = await db.Job.findOne({ where: { status: 'pending' }, order: [['createdAt','ASC']], lock: t.LOCK.UPDATE, transaction: t });
    if (!job) {
      await t.commit();
      return null;
    }

    await job.update({ status: 'running' }, { transaction: t });
    await t.commit();
    return job;
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

async function appendJobOutput(jobId, text) {
  if (!text) return;
  // Insert as-is; callers are responsible for splitting into lines if desired
  await db.JobStatus.create({ jobId, output: text });
}

async function runJob(job) {
  console.log(`JobRunner: running job ${job.id}: ${job.command}`);

  const child = spawn(job.command, { shell: true, cwd: WORKDIR });

  child.stdout.on('data', async chunk => {
    const text = chunk.toString();
    process.stdout.write(text);
    await appendJobOutput(job.id, text);
  });

  child.stderr.on('data', async chunk => {
    const text = chunk.toString();
    process.stderr.write(text);
    await appendJobOutput(job.id, text);
  });

  child.on('error', async err => {
    console.error(`Job ${job.id} spawn error:`, err);
    await appendJobOutput(job.id, `ERROR: ${err.message}`);
    await job.update({ status: 'failure' });
  });

  child.on('close', async code => {
    const finalStatus = code === 0 ? 'success' : 'failure';
    await appendJobOutput(job.id, `Process exited with code ${code}\n`);
    await job.update({ status: finalStatus });
    console.log(`Job ${job.id} completed with status ${finalStatus}`);
  });
}

async function loop() {
  if (shuttingDown) return;
  try {
    const job = await claimPendingJob();
    if (job) {
      // Run job but don't block polling loop; we will wait for job to update
      runJob(job).catch(err => console.error('runJob error', err));
    }
  } catch (err) {
    console.error('JobRunner loop error:', err);
  } finally {
    setTimeout(loop, POLL_INTERVAL_MS);
  }
}

process.on('SIGINT', () => { shuttingDown = true; console.log('JobRunner shutting down (SIGINT)'); process.exit(0); });
process.on('SIGTERM', () => { shuttingDown = true; console.log('JobRunner shutting down (SIGTERM)'); process.exit(0); });

async function start() {
  console.log('JobRunner starting, working dir:', WORKDIR);
  await db.sequelize.authenticate();
  console.log('DB connected');
  loop();
}

start().catch(err => { console.error('JobRunner failed to start:', err); process.exit(1); });
