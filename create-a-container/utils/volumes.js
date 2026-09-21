/**
 * Volume helpers shared by the container-create job and the API router.
 *
 * This is the single place that derives a volume's host path from a node
 * storage's ACTUAL configured path (never assuming the /mnt/pve/<storage>
 * layout the retired quick_and_dirty stopgap hardcoded).
 *
 * See https://github.com/mieweb/opensource-server/issues/421
 */

// Reserved name/mount of the legacy shared mount. Kept only so the API can
// reject a user volume that would collide with a pre-#421 backfilled row.
const { QUICK_AND_DIRTY_NAME, QUICK_AND_DIRTY_MOUNT } = require('../models/volume');

/**
 * Resolve the on-disk root directory for user volumes on a node, derived from
 * the node's configured `volumeStorage` (falling back to `imageStorage`). The
 * path is taken from Proxmox's storage config (`GET /storage/{storage}` →
 * `path`), never assumed. Volumes live under `<path>/volumes`.
 *
 * @param {object} client - NodeApi client (ProxmoxApi/DummyApi/DockerApi)
 * @param {object} node - Node model instance (for storage names + type)
 * @returns {Promise<{root: string, storage: string, shared: boolean}>}
 * @throws {Error} When the storage has no resolvable host path
 */
async function resolveVolumesRoot(client, node) {
  // Docker nodes have no Proxmox storage config; volumes root is a plain host
  // dir keyed by node so the Docker bind path is stable.
  if (node.nodeType === 'docker') {
    return { root: '/var/lib/opensource-server/volumes', storage: 'docker', shared: false };
  }

  const storageName = node.volumeStorage || node.imageStorage || 'local';
  if (typeof client.storageConfig !== 'function') {
    // Dummy nodes and any client without storage-config support: fall back to a
    // conventional path so the simulated create path still runs end to end.
    return { root: `/mnt/pve/${storageName}/volumes`, storage: storageName, shared: false };
  }

  let cfg;
  try {
    cfg = await client.storageConfig(storageName);
  } catch (err) {
    throw new Error(
      `Could not read storage config for '${storageName}' on node ${node.name}: ${err.message}`,
    );
  }

  // Path-backed storages (dir/nfs/cephfs/glusterfs) expose `path`. Block
  // storages (lvm/lvmthin/zfspool/rbd) do not and cannot host a bind directory.
  if (!cfg || !cfg.path) {
    throw new Error(
      `Storage '${storageName}' on node ${node.name} has no host path (type=${cfg?.type || 'unknown'}); ` +
        'volumes require a path-backed storage (dir/nfs/cephfs)',
    );
  }

  return {
    root: `${cfg.path.replace(/\/+$/, '')}/volumes`,
    storage: storageName,
    shared: cfg.shared === 1 || cfg.shared === '1' || cfg.shared === true,
  };
}

/**
 * Build the host path for a named, container-scoped volume under a volumes
 * root. Names are validated upstream (Volume.isValidName); this only joins.
 * @param {string} volumesRoot
 * @param {string} hostname - Container hostname (per-container scoping segment)
 * @param {string} name - Volume name
 * @returns {string}
 */
function containerVolumeHostPath(volumesRoot, hostname, name) {
  return `${volumesRoot}/${hostname}/${name}`;
}

/**
 * Derive and persist any missing host paths on a set of Volume rows, and mark
 * volumes that don't need the site agent as `ready`. Idempotent and shared by
 * the create/reconfigure/reconcile jobs so the derivation lives in one place.
 *
 * Built-in `quick_and_dirty` rows are a backfill artifact for pre-#421
 * containers (their live mount already exists on Proxmox). They are left
 * untouched: no host path is derived and they never render a new mpN — see
 * Volume.buildMountConfig, which skips them. Every other volume gets a derived
 * host path; on a docker node it is marked ready immediately (Docker
 * auto-creates bind sources).
 *
 * @param {Array<object>} volumes - Volume model instances
 * @param {object} opts
 * @param {string} opts.volumesRoot - Resolved volumes root for the node
 * @param {string} opts.hostname - Container hostname (per-container scoping)
 * @param {string} opts.nodeType - Node type ('proxmox' | 'docker' | 'dummy')
 * @returns {Promise<void>}
 */
async function deriveVolumeHostPaths(volumes, { volumesRoot, hostname, nodeType }) {
  for (const v of volumes) {
    // Legacy built-in rows are informational only; don't derive or re-mount.
    if (v.builtin) continue;
    const updates = {};
    if (!v.hostPath) {
      updates.hostPath = containerVolumeHostPath(volumesRoot, hostname, v.name);
    }
    // Docker auto-creates bind-source directories at container start, so there
    // is no site agent to wait on — mark docker volumes ready directly.
    if (nodeType === 'docker' && v.status !== 'ready') {
      updates.status = 'ready';
      updates.appliedAt = new Date();
    }
    if (Object.keys(updates).length > 0) await v.update(updates);
  }
}

module.exports = {
  resolveVolumesRoot,
  containerVolumeHostPath,
  deriveVolumeHostPaths,
  QUICK_AND_DIRTY_NAME,
  QUICK_AND_DIRTY_MOUNT,
};
