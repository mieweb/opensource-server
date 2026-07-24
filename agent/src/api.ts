/** Check-in client for the manager's POST /api/v1/agents endpoint. */

import type { AgentConfig } from './config';
import type { CheckinRequest, SiteConfig } from './types';
import { log } from './log';

export type CheckinResult =
  | { notModified: true }
  | { notModified: false; etag?: string; config: SiteConfig };

// Fail fast if the manager is unreachable or the connection stalls, so the
// oneshot unit exits predictably instead of hanging and queueing timer runs.
const CHECKIN_TIMEOUT_MS = 30_000;

export async function checkin(
  cfg: AgentConfig,
  body: CheckinRequest,
  etag?: string,
): Promise<CheckinResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (etag) headers['If-None-Match'] = etag;
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const url = `${cfg.managerUrl}/api/v1/agents`;
  log.debug(`check-in POST ${url}${etag ? ` (If-None-Match: ${etag})` : ''}${cfg.apiKey ? ' with API key' : ''}`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHECKIN_TIMEOUT_MS),
    });
  } catch (err) {
    // fetch rejects on network errors and on the abort timeout; distinguish
    // the timeout so a stalled manager is obvious in the logs.
    const reason =
      (err as Error)?.name === 'TimeoutError'
        ? `no response within ${CHECKIN_TIMEOUT_MS} ms`
        : (err as Error)?.message ?? String(err);
    log.error(`check-in request to ${url} failed: ${reason}`);
    throw err;
  }

  log.debug(`check-in response: HTTP ${res.status}`);
  if (res.status === 304) return { notModified: true };
  if (!res.ok) {
    log.error(`check-in rejected by manager: HTTP ${res.status}`);
    throw new Error(`Check-in failed: HTTP ${res.status}`);
  }

  const { data } = (await res.json()) as { data: SiteConfig };
  return {
    notModified: false,
    etag: res.headers.get('etag') ?? undefined,
    config: data,
  };
}
