/** Check-in client for the manager's POST /api/v1/agents endpoint. */

import type { AgentConfig } from './config';
import type { CheckinRequest, SiteConfig } from './types';

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

  const res = await fetch(`${cfg.managerUrl}/api/v1/agents`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CHECKIN_TIMEOUT_MS),
  });

  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`Check-in failed: HTTP ${res.status}`);

  const { data } = (await res.json()) as { data: SiteConfig };
  return {
    notModified: false,
    etag: res.headers.get('etag') ?? undefined,
    config: data,
  };
}
