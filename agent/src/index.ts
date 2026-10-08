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
import { getPrimaryIpv4, getServiceState, findMissingBinaries, disconnectSystemBus } from './system';
import { checkin } from './api';
import { services, GROUP_BINARIES, applyService, type ManagedService } from './apply';
import { mailServices, ensureMailProvisioned, syncMailUnits, gcMailboxes } from './mail';
import { reconcileVolumes } from './volumes';
import { log } from './log';
import type { CheckinRequest, ServiceStatus, SiteConfig } from './types';

// Safety cap: a flapping server-side config can't keep a single run alive
// forever; the timer starts a fresh run 30s later anyway.
const MAX_PASSES = 5;

const ALL_SERVICES: ManagedService[] = [...services, ...mailServices];

function enabledServices(cfg: AgentConfig): ManagedService[] {
  return ALL_SERVICES.filter((svc) => cfg.services.includes(svc.group));
}

async function buildCheckinBody(cfg: AgentConfig, state: State): Promise<CheckinRequest> {
  const serviceStatus: Record<string, ServiceStatus> = {};
  for (const svc of enabledServices(cfg)) {
    serviceStatus[svc.unit] = {
      state: await getServiceState(svc.statusUnit ?? svc.unit),
      lastApply: state.lastApply[svc.unit] ?? 'unknown',
    };
  }
  const body: CheckinRequest = {
    siteId: cfg.siteId,
    hostname: os.hostname(),
    currentTime: Math.floor(Date.now() / 1000),
    ipv4Address: getPrimaryIpv4(),
    services: serviceStatus,
    enabledServices: cfg.services,
    missingBinaries: findMissingBinaries(cfg.services.flatMap((g) => GROUP_BINARIES[g])),
  };
  // Report any not-yet-delivered volume results (persisted across runs). Only
  // include the field when there is something to report so the manager isn't
  // sent an empty map every check-in.
  if (Object.keys(state.pendingVolumeResults).length > 0) {
    body.volumes = { ...state.pendingVolumeResults };
  }
  return body;
}

/** Post-apply mail housekeeping: unit enable/start (holder) or stop/disable
 * (claim lost / group off), then mailbox GC. Failures are logged, not fatal
 * — the next timer run retries. */
async function syncMailLifecycle(cfg: AgentConfig, config: SiteConfig): Promise<void> {
  if (!cfg.services.includes('mail')) return;
  try {
    await syncMailUnits(config);
    if (config.mail) gcMailboxes(config.mail);
  } catch (err) {
    log.error(`mail: unit lifecycle sync failed: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const state = State.load(cfg.stateDir);
  log.info(`agent starting: siteId=${cfg.siteId}, manager=${cfg.managerUrl}, services=${cfg.services.join(',')}`);
  log.debug(`state dir=${cfg.stateDir}, saved etag=${state.etag ?? '(none)'}`);
  if (Object.keys(state.pendingVolumeResults).length > 0) {
    log.debug(`carrying ${Object.keys(state.pendingVolumeResults).length} pending volume result(s) from a prior run`);
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    log.debug(`check-in pass ${pass + 1}/${MAX_PASSES}`);
    // Remember what this check-in body carries so we can clear it only once the
    // request has actually completed (the manager processes the `volumes` map
    // before computing the ETag, so a 200 or a 304 both mean it was delivered).
    const carriedVolumeIds = Object.keys(state.pendingVolumeResults);
    const result = await checkin(cfg, await buildCheckinBody(cfg, state), state.etag);

    // The check-in completed, so any results it carried are now delivered.
    if (carriedVolumeIds.length > 0) {
      for (const id of carriedVolumeIds) delete state.pendingVolumeResults[id];
      state.save();
    }

    if (result.notModified) {
      log.info('check-in: config unchanged (304), nothing to apply');
      return;
    }

    log.info(`check-in: new config received (etag=${result.etag ?? '(none)'}), applying`);
    // Mail users/dirs must exist before the mail configs reference them.
    if (cfg.services.includes('mail') && result.config.mail) {
      ensureMailProvisioned();
    }
    for (const svc of enabledServices(cfg)) {
      state.lastApply[svc.unit] = await applyService(svc, result.config, cfg);
    }
    await syncMailLifecycle(cfg, result.config);

    // Ensure volume directories exist from the new snapshot; stash results in
    // persistent state so they are reported on the next check-in and survive a
    // process exit in between (they are cleared once delivered, above).
    const volumeResults = reconcileVolumes(result.config);
    if (volumeResults) {
      Object.assign(state.pendingVolumeResults, volumeResults);
    }

    // A failed volume mkdir is typically transient (a not-yet-mounted volumes
    // root, a slow shared mount, a momentary permission glitch) and WILL fix
    // itself on a retry without any server-side config change. If we saved the
    // ETag now, the next run would get a 304 and never re-run the reconcile,
    // leaving the volume `failed` until the config changes. So when any volume
    // failed this pass, do NOT persist the ETag — forcing the next check-in to
    // re-fetch the config (200, not 304) and re-run the reconcile. Service
    // applies keep the existing "save even on failure" behavior (a rejected
    // nginx/dnsmasq config won't fix itself without a server-side change).
    const volumeFailed = volumeResults
      ? Object.values(volumeResults).some((r) => !r.applied)
      : false;
    if (volumeFailed) {
      log.warn('one or more volume directories failed to provision; will retry on next check-in');
      state.etag = undefined;
    } else {
      state.etag = result.etag;
    }
    state.save();
  }

  // MAX_PASSES exhausted (flapping server-side config): check in once more so
  // the final pass' apply/volume results reach the manager instead of going
  // stale until the next timer run. Clear delivered results afterwards.
  log.warn(`reached MAX_PASSES (${MAX_PASSES}) without a stable config; reporting final results`);
  const carried = Object.keys(state.pendingVolumeResults);
  await checkin(cfg, await buildCheckinBody(cfg, state), state.etag);
  if (carried.length > 0) {
    for (const id of carried) delete state.pendingVolumeResults[id];
    state.save();
  }
}

main()
  .then(() => disconnectSystemBus())
  .catch((err) => {
    // Log the full error (stack included when present) so a failed run is
    // diagnosable from the journal, not just a one-line message.
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
