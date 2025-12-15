#!/usr/bin/env node
/**
 * job-runner.js
 * - Checks ScheduledJobs and creates pending Jobs when schedule conditions are met
 * - Polls the Jobs table for pending jobs
 * - Claims a job (transactionally), sets status to 'running'
 * - Spawns the configured command and streams stdout/stderr into JobStatuses
 * - Marks job success/failure on exit
 */

const { spawn } = require('child_process');
const path = require('path');
const parser = require('cron-parser');
const db = require('./models');

const POLL_INTERVAL_MS = parseInt(process.env.JOB_RUNNER_POLL_MS || '2000', 10);
const WORKDIR = process.env.JOB_RUNNER_CWD || process.cwd();

let shuttingDown = false;
// Map of jobId -> child process for active/running jobs
const activeChildren = new Map();
// Track last scheduled job execution time to avoid duplicate runs
const lastScheduledExecution = new Map();

async function shouldScheduledJobRun(scheduledJob) {
  try {
    const interval = parser.parseExpression(scheduledJob.schedule);
    const now = new Date();
    const lastExecution = lastScheduledExecution.get(scheduledJob.id);
    
    // Get the next occurrence from the schedule
    const nextExecution = interval.next().toDate();
    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    const nextMinute = new Date(nextExecution.getFullYear(), nextExecution.getMonth(), nextExecution.getDate(), nextExecution.getHours(), nextExecution.getMinutes());
    
    // If the next scheduled time is now and we haven't executed in this minute
    if (currentMinute.getTime() === nextMinute.getTime()) {
      if (!lastExecution || lastExecution.getTime() < currentMinute.getTime()) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error(`Error parsing schedule for job ${scheduledJob.id}: ${err.message}`);
    return false;
  }
}

async function processScheduledJobs() {
  try {
    const scheduledJobs = await db.ScheduledJob.findAll();
    
    for (const scheduledJob of scheduledJobs) {
      if (await shouldScheduledJobRun(scheduledJob)) {
        console.log(`JobRunner: Creating job from scheduled job ${scheduledJob.id}: ${scheduledJob.schedule}`);
        
        try {
          await db.Job.create({
            command: scheduledJob.command,
            status: 'pending',
            createdBy: `ScheduledJob#${scheduledJob.id}`
          });
          
          // Mark that we've executed this scheduled job at this time
          lastScheduledExecution.set(scheduledJob.id, new Date());
        } catch (err) {
          console.error(`Error creating job from scheduled job ${scheduledJob.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Error processing scheduled jobs:', err);
  }
}

async function claimPendingJob() {
  const sequelize = db.sequelize;
  return await sequelize.transaction(async (t) => {
    const job = await db.Job.findOne({
      where: { status: 'pending' },
      order: [['createdAt', 'ASC']],
      lock: db.Sequelize.Transaction.LOCK.UPDATE,
      transaction: t,
    });

    if (!job) return null;

    await job.update({ status: 'running' }, { transaction: t });
    return job;
  });
}

async function appendJobOutput(jobId, text) {
  if (!text) return;
  // Insert as-is; callers are responsible for splitting into lines if desired
  await db.JobStatus.create({ jobId, output: text });
}

async function runJob(job) {
  console.log(`JobRunner: running job ${job.id}: ${job.command}`);

  const child = spawn(job.command, { shell: true, cwd: WORKDIR });
  activeChildren.set(job.id, child);

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
    activeChildren.delete(job.id);
    try {
      const fresh = await db.Job.findByPk(job.id);
      if (fresh && fresh.status === 'running') {
        await fresh.update({ status: 'failure' });
      }
    } catch (e) {
      console.error('Error updating job status after spawn error:', e);
    }
  });

  child.on('close', async code => {
    activeChildren.delete(job.id);
    const finalStatus = code === 0 ? 'success' : 'failure';
    await appendJobOutput(job.id, `Process exited with code ${code}\n`);
    try {
      const fresh = await db.Job.findByPk(job.id);
      if (fresh && fresh.status === 'running') {
        await fresh.update({ status: finalStatus });
      }
    } catch (e) {
      console.error('Error updating job status on close:', e);
    }
    console.log(`Job ${job.id} completed with status ${finalStatus}`);
  });
}

async function shutdownAndCancelJobs(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`JobRunner shutting down (${signal})`);

  const entries = Array.from(activeChildren.entries());
  if (entries.length === 0) {
    process.exit(0);
    return;
  }

  // Tell each job we're cancelling it, kill the process and mark cancelled in DB
  for (const [jobId, child] of entries) {
    try {
      await appendJobOutput(jobId, `Runner shutting down (${signal}), cancelling job\n`);
    } catch (e) {
      console.error('appendJobOutput error during shutdown:', e);
    }

    try {
      // Try graceful termination first
      child.kill('SIGTERM');
    } catch (e) {
      console.error(`Error sending SIGTERM to job ${jobId}:`, e);
    }

    try {
      await db.Job.update({ status: 'cancelled' }, { where: { id: jobId, status: 'running' } });
    } catch (e) {
      console.error(`Error marking job ${jobId} cancelled:`, e);
    }
  }

  // Wait briefly for processes to exit, then force-kill any remaining
  await new Promise(res => setTimeout(res, 2000));
  for (const [jobId, child] of Array.from(activeChildren.entries())) {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch (e) {
      console.error(`Error force-killing job ${jobId}:`, e);
    }
    activeChildren.delete(jobId);
  }

  process.exit(0);
}

async function loop() {
  if (shuttingDown) return;
  try {
    // Check for scheduled jobs that should run (run async so it doesn't block the loop)
    processScheduledJobs().catch(err => console.error('processScheduledJobs error', err));
    
    // Check for pending jobs
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

process.on('SIGINT', () => { shutdownAndCancelJobs('SIGINT').catch(err => { console.error('Shutdown error:', err); process.exit(1); }); });
process.on('SIGTERM', () => { shutdownAndCancelJobs('SIGTERM').catch(err => { console.error('Shutdown error:', err); process.exit(1); }); });

async function start() {
  console.log('JobRunner starting, working dir:', WORKDIR);
  await db.sequelize.authenticate();
  console.log('DB connected');
  loop();
}

start().catch(err => { console.error('JobRunner failed to start:', err); process.exit(1); });
