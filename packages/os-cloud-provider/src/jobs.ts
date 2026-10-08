/**
 * Job polling. `get_job` (`GET /jobs/{id}`) carries the terminal verdict
 * (`Job.status`); `GET /jobs/{id}/status` only returns output log rows, which
 * we forward to the logger as they arrive.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { DeployLogger } from '@mieweb/deploy-contract';
import type { ManagerClient } from './client.ts';

export interface WaitOptions {
  signal: AbortSignal;
  logger: DeployLogger;
  intervalMs?: number;
  /** Secret values to mask as `***` in relayed job output. */
  redact?: Iterable<string>;
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

/** Replace every occurrence of each secret with `***`. */
export function mask(text: string, secrets: Iterable<string> | undefined): string {
  let out = text;
  for (const s of secrets ?? []) if (s) out = out.split(s).join('***');
  return out;
}

const TERMINAL = new Set(['success', 'failure', 'cancelled']);
const TIMEOUT_MS = 30 * 60 * 1000;
const PAGE = 500;

/** Poll a job until it reaches a terminal status; throw unless it succeeded. */
export async function waitForJob(client: ManagerClient, jobId: number, opts: WaitOptions): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  const path = { params: { path: { id: jobId } } };
  const tail: string[] = [];
  let offset = 0;

  const drainLogs = async (): Promise<void> => {
    for (;;) {
      const rows =
        (await client.call((api) =>
          api.GET('/jobs/{id}/status', { params: { path: { id: jobId }, query: { offset, limit: PAGE } } }),
        )) ?? [];
      for (const row of rows) {
        for (const line of mask(row.output ?? '', opts.redact).split('\n')) {
          if (line.trim() === '') continue;
          opts.logger.info(`  [job ${jobId}] ${line}`);
          tail.push(line);
          if (tail.length > 20) tail.shift();
        }
      }
      offset += rows.length;
      if (rows.length < PAGE) return;
    }
  };

  for (;;) {
    const status = (await client.call((api) => api.GET('/jobs/{id}', path)))?.status ?? 'unknown';
    await drainLogs();
    if (TERMINAL.has(status)) {
      if (status === 'success') return;
      throw new JobFailedError(jobId, status, tail);
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for Manager job ${jobId} (last status "${status}")`);
    // Surface the caller's abort reason, not Node's generic AbortError.
    await sleep(opts.intervalMs ?? 2000, undefined, { signal: opts.signal }).catch((err: unknown) => {
      throw opts.signal.reason ?? err;
    });
  }
}
