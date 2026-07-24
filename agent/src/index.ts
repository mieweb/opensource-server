#!/usr/bin/env node
/**
 * opensource-agent: oneshot check-in with the manager, launched every 30s by
 * a systemd timer.
 *
 * Each pass POSTs system info + service states to /api/v1/agents with the
 * last applied config ETag in If-None-Match. A 304 means nothing changed and
 * the agent exits. A 200 carries the site's config snapshot: the agent
 * renders, tests and applies it, then checks in again to report the apply
 * results — repeating until it gets a 304.
 */

import os from 'os';
import { loadConfig, type AgentConfig } from './config';
import { State } from './state';
import { getPrimaryIpv4, getServiceState, disconnectSystemBus } from './system';
import { checkin } from './api';
import { services, applyService } from './apply';
import { log } from './log';
import type { CheckinRequest, ServiceStatus } from './types';

// Safety cap: a flapping server-side config can't keep a single run alive
// forever; the timer starts a fresh run 30s later anyway.
const MAX_PASSES = 5;

async function buildCheckinBody(cfg: AgentConfig, state: State): Promise<CheckinRequest> {
  const serviceStatus: Record<string, ServiceStatus> = {};
  for (const svc of services) {
    serviceStatus[svc.unit] = {
      state: await getServiceState(svc.unit),
      lastApply: state.lastApply[svc.unit] ?? 'unknown',
    };
  }
  return {
    siteId: cfg.siteId,
    hostname: os.hostname(),
    currentTime: Math.floor(Date.now() / 1000),
    ipv4Address: getPrimaryIpv4(),
    services: serviceStatus,
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const state = State.load(cfg.stateDir);
  log.info(`agent starting: siteId=${cfg.siteId}, manager=${cfg.managerUrl}`);
  log.debug(`state dir=${cfg.stateDir}, saved etag=${state.etag ?? '(none)'}`);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    log.debug(`check-in pass ${pass + 1}/${MAX_PASSES}`);
    const result = await checkin(cfg, await buildCheckinBody(cfg, state), state.etag);
    if (result.notModified) {
      log.info('check-in: config unchanged (304), nothing to apply');
      return;
    }

    log.info(`check-in: new config received (etag=${result.etag ?? '(none)'}), applying`);
    for (const svc of services) {
      state.lastApply[svc.unit] = await applyService(svc, result.config);
    }

    // The ETag is saved even after a failed apply: a rejected config won't
    // fix itself without a server-side change (which changes the ETag), and
    // the failure has been reported via lastApply.
    state.etag = result.etag;
    state.save();
  }

  // MAX_PASSES exhausted (flapping server-side config): check in once more so
  // the final pass' apply results reach the manager instead of going stale
  // until the next timer run.
  log.warn(`reached MAX_PASSES (${MAX_PASSES}) without a stable config; reporting final results`);
  await checkin(cfg, await buildCheckinBody(cfg, state), state.etag);
}

main()
  .then(() => disconnectSystemBus())
  .catch((err) => {
    // Log the full error (stack included when present) so a failed run is
    // diagnosable from the journal, not just a one-line message.
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
