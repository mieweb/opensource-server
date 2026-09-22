/**
 * Volume directory reconciliation (issue #421).
 *
 * The manager includes, at the site level, the volume directories that must
 * exist (id, hostPath, mode, and the owning host uid/gid). The shared volumes
 * root is bind-mounted into the agent guest by the installer, so these paths are
 * visible and writable here.
 *
 * Ownership is applied BEST-EFFORT via chown, which is correct in both agent
 * topologies:
 *   - Unprivileged agent guest (production): the agent's root already maps to
 *     the host owner (100000), so mkdir yields the right owner and the chown is
 *     a no-op — and if the guest lacks the capability, the EPERM is ignored.
 *   - Privileged agent guest (e.g. the dev-stack Manager CT): the agent is host
 *     root, so mkdir would otherwise create a root-owned directory; the chown
 *     fixes it so an unprivileged consuming container can write RW volumes.
 * A failed chown is logged and ignored — it never fails the volume, since the
 * unprivileged-guest case relies on the id-map, not the chown.
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
 * Ensure a single volume directory exists with the right owner and mode.
 * Idempotent: mkdir -p, best-effort chown, then chmod every run (cheap,
 * self-healing).
 * @param {SiteVolume} volume
 * @returns {VolumeResult}
 */
function ensureVolume(volume: SiteVolume): VolumeResult {
  const { hostPath, mode, uid, gid } = volume;
  try {
    fs.mkdirSync(hostPath, { recursive: true });
    // Best-effort ownership (see module header): required in a privileged agent
    // guest, a harmless no-op in an unprivileged one. EPERM is ignored — the
    // unprivileged case gets correct ownership from the id-map, not the chown.
    if (typeof uid === 'number' && typeof gid === 'number') {
      try {
        fs.chownSync(hostPath, uid, gid);
      } catch (chownErr) {
        const code = (chownErr as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'ENOSYS') {
          log.debug(`volume ${volume.id}: chown not permitted (${code}); relying on id-map`);
        } else {
          throw chownErr;
        }
      }
    }
    fs.chmodSync(hostPath, mode === 'rw' ? RW_MODE : RO_MODE);
    log.debug(`volume ${volume.id}: ensured ${hostPath} (mode=${mode}, owner=${uid}:${gid})`);
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
