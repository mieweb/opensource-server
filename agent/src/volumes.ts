/**
 * Volume directory reconciliation (issue #421).
 *
 * The manager includes, at the site level, the volume directories that must
 * exist (id, hostPath, mode). The shared volumes root is bind-mounted into the
 * agent guest by the installer, so these paths are visible and writable here.
 *
 * The agent is an unprivileged LXC guest mapped the same way as the containers
 * that consume the volumes (host UID/GID 100000 = guest root). So the agent's
 * root `mkdir`s the directory as host 100000 — exactly the mapped root of those
 * containers — and RW volumes are writable from inside them WITHOUT an explicit
 * chown (which would be EPERM inside the guest anyway). The agent therefore only
 * `mkdir -p`s and `chmod`s; it never chowns.
 *
 * There is one agent per site (not per node); the volumes root lives on storage
 * shared across the site's nodes, so this single agent provisions every site
 * volume regardless of which node hosts the container.
 *
 * Results are reported per volume id at the next check-in, which the manager
 * writes into Volume.status. Directory creation is retain-only: the agent never
 * removes a volume directory, so data survives container delete + recreate.
 */

import fs from 'fs';
import { log } from './log';
import type { SiteConfig, SiteVolume, VolumeResult } from './types';

// Mode for created directories. RW volumes get owner/group rwx (the id-mapped
// container root owns the dir, so it can write); RO volumes are r-x. World bits
// are left closed so other tenants can't read another container's data.
const RW_MODE = 0o0770;
const RO_MODE = 0o0550;

/**
 * Collect the volumes to provision from the config snapshot (site-level).
 * @param {SiteConfig} config
 * @returns {SiteVolume[]}
 */
export function volumesForSite(config: SiteConfig): SiteVolume[] {
  return config.site?.volumes ?? [];
}

/**
 * Ensure a single volume directory exists with the right mode. Idempotent:
 * mkdir -p, then chmod every run (cheap, self-healing). No chown — see module
 * header (the id-map establishes ownership).
 * @param {SiteVolume} volume
 * @returns {VolumeResult}
 */
function ensureVolume(volume: SiteVolume): VolumeResult {
  const { hostPath, mode } = volume;
  try {
    fs.mkdirSync(hostPath, { recursive: true });
    fs.chmodSync(hostPath, mode === 'rw' ? RW_MODE : RO_MODE);
    log.debug(`volume ${volume.id}: ensured ${hostPath} (mode=${mode})`);
    return { applied: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`volume ${volume.id}: failed to ensure ${hostPath}: ${message}`);
    return { applied: false, message };
  }
}

/**
 * Reconcile all volume directories for this site. Returns a results map keyed
 * by volume id for the check-in body, or undefined when there is nothing to do
 * (so the check-in omits the field on older managers / empty sites).
 * @param {SiteConfig} config
 * @returns {Record<string, VolumeResult> | undefined}
 */
export function reconcileVolumes(
  config: SiteConfig,
): Record<string, VolumeResult> | undefined {
  const volumes = volumesForSite(config);
  if (volumes.length === 0) return undefined;

  log.info(`volumes: ensuring ${volumes.length} directory(ies)`);
  const results: Record<string, VolumeResult> = {};
  for (const volume of volumes) {
    results[String(volume.id)] = ensureVolume(volume);
  }
  return results;
}
