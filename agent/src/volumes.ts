/**
 * Volume directory reconciliation (issue #421).
 *
 * The manager includes, per node, the volume directories that must exist on the
 * host (id, hostPath, mode, owning uid/gid). This node's entry is matched by
 * hostname. For each volume the agent `mkdir -p`s the directory and sets its
 * ownership/mode so the unprivileged container's id-mapped root can write to RW
 * volumes. Results are reported per volume id at the next check-in, which the
 * manager writes into Volume.status.
 *
 * The agent runs as root (systemd unit has no User=), so it can chown.
 * Directory creation is retain-only: the agent never removes a volume
 * directory, so data survives container delete+recreate.
 */

import fs from 'fs';
import os from 'os';
import { log } from './log';
import type { SiteConfig, SiteVolume, VolumeResult } from './types';

// Mode for created directories. RW volumes get group/owner write so the
// id-mapped container root (owner) can write; RO volumes are read/execute only
// for others. The owner is set via chown to the mapped host uid/gid.
const RW_MODE = 0o0770;
const RO_MODE = 0o0755;

/**
 * Collect the volumes this node must provision from the config snapshot,
 * matching the node whose `name` equals this host's hostname.
 * @param {SiteConfig} config
 * @param {string} hostname
 * @returns {SiteVolume[]}
 */
export function volumesForHost(config: SiteConfig, hostname: string): SiteVolume[] {
  const nodes = config.site?.nodes ?? [];
  const node = nodes.find((n) => n.name === hostname);
  return node?.volumes ?? [];
}

/**
 * Ensure a single volume directory exists with the right ownership/mode.
 * Idempotent: mkdir -p, then chown/chmod every run (cheap, self-healing).
 * @param {SiteVolume} volume
 * @returns {VolumeResult}
 */
function ensureVolume(volume: SiteVolume): VolumeResult {
  const { hostPath, mode, uid, gid } = volume;
  try {
    fs.mkdirSync(hostPath, { recursive: true });
    // Ownership: the unprivileged CT's id-mapped root, so RW mounts are
    // writable from inside the container.
    fs.chownSync(hostPath, uid, gid);
    fs.chmodSync(hostPath, mode === 'rw' ? RW_MODE : RO_MODE);
    log.debug(`volume ${volume.id}: ensured ${hostPath} (mode=${mode}, ${uid}:${gid})`);
    return { applied: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`volume ${volume.id}: failed to ensure ${hostPath}: ${message}`);
    return { applied: false, message };
  }
}

/**
 * Reconcile all volume directories for this host. Returns a results map keyed
 * by volume id for the check-in body, or undefined when there is nothing to do
 * (so the check-in omits the field on older managers / empty sites).
 * @param {SiteConfig} config
 * @param {string} [hostname]
 * @returns {Record<string, VolumeResult> | undefined}
 */
export function reconcileVolumes(
  config: SiteConfig,
  hostname: string = os.hostname(),
): Record<string, VolumeResult> | undefined {
  const volumes = volumesForHost(config, hostname);
  if (volumes.length === 0) return undefined;

  log.info(`volumes: ensuring ${volumes.length} directory(ies) on ${hostname}`);
  const results: Record<string, VolumeResult> = {};
  for (const volume of volumes) {
    results[String(volume.id)] = ensureVolume(volume);
  }
  return results;
}
