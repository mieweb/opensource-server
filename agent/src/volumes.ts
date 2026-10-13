/**
 * Volume directory reconciliation (issue #421).
 *
 * The manager includes, at the site level, the volume directories that must
 * exist (id, hostPath, mode, and the owning host uid/gid). The shared volumes
 * root is bind-mounted into the agent guest by the installer, so these paths are
 * visible and writable here.
 *
 * Ownership is applied BEST-EFFORT via chown, so it is correct whether the
 * agent runs in an unprivileged or (rare) privileged guest:
 *   - Unprivileged agent guest (the norm — `pct create` defaults to
 *     `--unprivileged 1`, which includes the embedded Manager agent): the
 *     agent's root already maps to the host owner (100000), so mkdir yields the
 *     right owner. The chown to 100000 then targets an id outside the guest's
 *     mapped range and is a tolerated no-op (see EINVAL/EPERM/ENOSYS below).
 *   - Privileged agent guest (only if deliberately created with
 *     `--unprivileged 0`): the agent is host root, so mkdir would otherwise
 *     create a root-owned directory; the chown fixes it so an unprivileged
 *     consuming container can write RW volumes.
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

// Mode for volume roots, like /var/lib: the id-mapped container root owns the
// dir (rwx for RW, r-x for RO) and non-root service accounts inside the
// container can traverse it to their own subdirectories. Isolation between
// tenants comes from each container mounting only its own volume.
const RW_MODE = 0o0755;
const RO_MODE = 0o0555;

/**
 * Collect the volumes to provision from the config snapshot (site-level).
 * @param {SiteConfig} config
 * @returns {SiteVolume[]}
 */
export function volumesForSite(config: SiteConfig): SiteVolume[] {
  return config.site?.volumes ?? [];
}

/**
 * Mount points visible to this process, from /proc/self/mountinfo (field 5,
 * with the kernel's octal escapes for space/tab/newline/backslash decoded).
 * @returns {string[]}
 */
export function readMountPoints(): string[] {
  const text = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' ')[4])
    .filter((mp): mp is string => typeof mp === 'string')
    .map((mp) => mp.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))));
}

/**
 * The deepest mount point that contains `path` ('/' when nothing more specific
 * does).
 * @param {string} path
 * @param {string[]} mountPoints
 * @returns {string}
 */
export function containingMountPoint(path: string, mountPoints: string[]): string {
  let best = '/';
  for (const mp of mountPoints) {
    if (mp === '/') continue;
    if ((path === mp || path.startsWith(`${mp}/`)) && mp.length > best.length) best = mp;
  }
  return best;
}

/**
 * Ensure a single volume directory exists with the right owner and mode.
 * Idempotent: mkdir -p, best-effort chown, then chmod every run (cheap,
 * self-healing).
 *
 * Refuses to create anything unless `hostPath` lies on a mount other than the
 * agent's root filesystem. The volumes root must be bind-mounted into the agent
 * (see "Deploying Agents"); if it isn't, `mkdir -p` would silently create the
 * path inside the agent guest's own rootfs and report success, letting the
 * manager's readiness barrier pass while the Proxmox host path is still
 * missing — so the mpN attach would then fail. Reporting a failure here
 * surfaces the misconfiguration as `Volume.status = failed` with a clear
 * message instead.
 * @param {SiteVolume} volume
 * @param {string[]} mountPoints
 * @returns {VolumeResult}
 */
function ensureVolume(volume: SiteVolume, mountPoints: string[]): VolumeResult {
  const { hostPath, mode, uid, gid } = volume;
  try {
    if (containingMountPoint(hostPath, mountPoints) === '/') {
      throw new Error(
        `${hostPath} is not on a mounted volumes root (it would be created inside the agent's own ` +
          'filesystem); bind-mount the shared volumes root into the agent container',
      );
    }
    fs.mkdirSync(hostPath, { recursive: true });
    // Best-effort ownership (see module header): the real fix in a privileged
    // agent guest (agent is host root), and a harmless no-op in an unprivileged
    // one — where mkdir already yields the correct owner via the id-map. Several
    // failures are therefore EXPECTED and tolerated rather than failing the
    // volume:
    //   - EINVAL: the target host id (e.g. 100000) is outside the unprivileged
    //     guest's mapped range, so it isn't a valid id to chown to from inside
    //     the guest. This is the normal unprivileged case — ownership is already
    //     correct from the id-map, so ignore it.
    //   - EPERM:  the guest lacks CAP_CHOWN.
    //   - ENOSYS: chown unsupported.
    if (typeof uid === 'number' && typeof gid === 'number') {
      try {
        fs.chownSync(hostPath, uid, gid);
      } catch (chownErr) {
        const code = (chownErr as NodeJS.ErrnoException).code;
        if (code === 'EINVAL' || code === 'EPERM' || code === 'ENOSYS') {
          log.debug(`volume ${volume.id}: chown to ${uid}:${gid} skipped (${code}); relying on id-map`);
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
 * @param {string[]} [mountPoints] Mount points to check paths against;
 *   defaults to this process's /proc/self/mountinfo (injectable for tests).
 * @returns {Record<string, VolumeResult> | undefined}
 */
export function reconcileVolumes(
  config: SiteConfig,
  mountPoints?: string[],
): Record<string, VolumeResult> | undefined {
  const volumes = volumesForSite(config);
  if (volumes.length === 0) return undefined;

  log.info(`volumes: ensuring ${volumes.length} directory(ies)`);
  let mounts: string[];
  try {
    mounts = mountPoints ?? readMountPoints();
  } catch (err) {
    // Can't tell whether the volumes root is mounted, so fail closed rather
    // than risk reporting a guest-local directory as provisioned.
    const message = `cannot read mount table: ${err instanceof Error ? err.message : String(err)}`;
    log.error(`volumes: ${message}`);
    return Object.fromEntries(volumes.map((v) => [String(v.id), { applied: false, message }]));
  }
  const results: Record<string, VolumeResult> = {};
  for (const volume of volumes) {
    results[String(volume.id)] = ensureVolume(volume, mounts);
  }
  return results;
}
