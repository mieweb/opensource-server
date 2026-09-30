/**
 * Job polling. `get_job` (`GET /jobs/{id}`) carries the terminal verdict
 * (`Job.status`); `GET /jobs/{id}/status` only returns output log rows, which
 * we forward to the logger as they arrive.
 */

import type { DeployLogger } from '@mieweb/deploy-contract';
import type { Job, JobLogRow } from './api-types.ts';
import type { ManagerClient } from './client.ts';

export interface WaitOptions {
  signal: AbortSignal;
  logger: DeployLogger;
  intervalMs?: number;
  timeoutMs?: number;
  /** Forward the job's output rows to the logger (default true). */
  streamLogs?: boolean;
}

export class JobFailedError extends Error {
  readonly jobId: number;
  readonly status: string;
  constructor(jobId: number, status: string, tail: string[]) {
    super(`Manager job ${jobId} ended with status "${status}"${tail.length ? `:\n${tail.join('\n')}` : ''}`);
    this.name = 'JobFailedError';
    this.jobId = jobId;
    this.status = status;
  }
}

/** Resolve after `ms`, or reject with the signal's reason on abort. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const TERMINAL = new Set(['success', 'failure', 'cancelled']);

/** Poll a job until it reaches a terminal status; throw unless it succeeded. */
export async function waitForJob(client: ManagerClient, jobId: number, opts: WaitOptions): Promise<void> {
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60 * 1000);
  const stream = opts.streamLogs !== false;
  const tail: string[] = [];
  let offset = 0;

  const drainLogs = async (): Promise<void> => {
    if (!stream) return;
    for (;;) {
      const rows = await client.get<JobLogRow[]>(`/jobs/${jobId}/status`, { offset, limit: 500 });
      for (const row of rows) {
        for (const line of String(row.output ?? '').split('\n')) {
          if (line.trim() === '') continue;
          opts.logger.info(`  [job ${jobId}] ${line}`);
          tail.push(line);
          if (tail.length > 20) tail.shift();
        }
      }
      offset += rows.length;
      if (rows.length < 500) return;
    }
  };

  for (;;) {
    const job = await client.get<Job>(`/jobs/${jobId}`);
    await drainLogs();
    if (TERMINAL.has(job.status)) {
      if (job.status === 'success') return;
      throw new JobFailedError(jobId, job.status, tail);
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for Manager job ${jobId} (last status "${job.status}")`);
    }
    await sleep(interval, opts.signal);
  }
}
