/**
 * container-status.js — resolve the *live* status of a container.
 *
 * Historically the container "status" was a static column in the database that
 * was only mutated by the create/reconfigure job scripts. That value drifts out
 * of reality whenever something changes a container directly in Proxmox (or when
 * a job dies without updating the row). This module computes the real status on
 * demand by combining two sources of truth:
 *
 *   1. Proxmox    — does the LXC exist, and is it running or stopped? This comes
 *                   from a single per-node `clusterResources('lxc')` snapshot.
 *   2. Create job — for containers not yet in Proxmox: is the create job still
 *                   active, did it fail, or is it gone? The create job is linked
 *                   to the container by the `creationJobId` foreign key, so this
 *                   is a cheap primary-key lookup (or free when eager-loaded).
 *
 * Resolved statuses:
 *   running   — exists in Proxmox and is online
 *   offline   — exists in Proxmox but is stopped
 *   creating  — not in Proxmox, but has an active (pending/running) create job
 *   failed    — not in Proxmox, create job returned failure
 *   missing   — not in Proxmox, create job succeeded or no create job found
 *   unknown   — Proxmox could not be reached / node has no API credentials
 *
 * Note: there is intentionally no per-container Proxmox config read here. Proxmox
 * has no bulk config endpoint, so config-drift detection would be O(N) network
 * round-trips for the list page; it was dropped in favour of keeping status
 * resolution cheap (one Proxmox call per node, zero per container).
 */

const STATUS = Object.freeze({
  RUNNING: 'running',
  OFFLINE: 'offline',
  CREATING: 'creating',
  FAILED: 'failed',
  MISSING: 'missing',
  UNKNOWN: 'unknown',
});

const STATUS_VALUES = Object.freeze(Object.values(STATUS));

const ACTIVE_JOB_STATUSES = ['pending', 'running'];

function nodeHasApiAccess(node) {
  return !!(node && typeof node.hasApiAccess === 'function' && node.hasApiAccess());
}

/**
 * Resolve the create job for a container via its `creationJobId` foreign key.
 * Prefers an already-loaded `creationJob` association (zero queries); otherwise
 * does a single primary-key lookup. Returns null if the container has no linked
 * create job.
 * @param {object} container - Container instance (ideally with creationJob assoc)
 * @param {object} Job - Job model
 * @returns {Promise<object|null>}
 */
async function findCreateJob(container, Job) {
  if (container.creationJob) return container.creationJob;
  if (container.creationJobId) return Job.findByPk(container.creationJobId);
  return null;
}

function isActiveJob(job) {
  return !!job && ACTIVE_JOB_STATUSES.includes(job.status);
}

/**
 * Locate a container in a cluster-resources snapshot by VMID.
 * @param {Array<object>|null} snapshot - Result of ProxmoxApi.clusterResources('lxc')
 * @param {number} vmid
 * @returns {object|null} The matching resource entry or null
 */
function findInSnapshot(snapshot, vmid) {
  if (!Array.isArray(snapshot) || vmid == null) return null;
  return snapshot.find((r) => r.vmid === vmid) || null;
}

/**
 * Resolve status from already-gathered facts. Pure function — no I/O — so it is
 * trivial to unit test and is the single source of the decision tree.
 *
 * @param {object} facts
 * @param {boolean} facts.proxmoxReachable - Whether Proxmox was queried OK.
 * @param {boolean} facts.inProxmox - Whether the LXC exists in Proxmox.
 * @param {boolean} facts.proxmoxRunning - Whether the LXC is running.
 * @param {boolean} facts.hasVmid - Whether the container has a Proxmox VMID.
 * @param {boolean} facts.creating - Active create job present.
 * @param {boolean} facts.createFailed - Create job returned failure.
 * @returns {string} STATUS value
 */
function decideStatus(facts) {
  if (facts.inProxmox) {
    return facts.proxmoxRunning ? STATUS.RUNNING : STATUS.OFFLINE;
  }

  if (facts.creating) return STATUS.CREATING;

  // We had a VMID + creds but couldn't reach Proxmox: don't guess missing.
  if (facts.hasVmid && !facts.proxmoxReachable) return STATUS.UNKNOWN;

  if (facts.createFailed) return STATUS.FAILED;
  return STATUS.MISSING;
}

/**
 * Compute the live status of a single container.
 *
 * @param {object} params
 * @param {object} params.container - Container instance (with `node` association,
 *   and ideally the `creationJob` association eager-loaded).
 * @param {object} params.Job - Job model (from models).
 * @param {object} [params.api] - Optional pre-authenticated ProxmoxApi client for
 *   the container's node (lets callers reuse one client across many containers).
 * @param {{ data: Array<object>, ok: boolean }} [params.snapshot] - Optional
 *   pre-fetched clusterResources('lxc') snapshot for the node. `ok` indicates the
 *   query succeeded; `data` is the resource list (used for batching the index).
 * @returns {Promise<string>} One of the STATUS values.
 */
async function computeContainerStatus({ container, Job, api, snapshot }) {
  const node = container.node;
  const hasCreds = nodeHasApiAccess(node);
  const hasVmid = container.containerId != null;

  // --- Determine Proxmox presence / run state ---
  let proxmoxReachable = false;
  let inProxmox = false;
  let proxmoxRunning = false;

  if (hasVmid && hasCreds) {
    try {
      let resources;
      if (snapshot) {
        proxmoxReachable = !!snapshot.ok;
        resources = snapshot.ok ? snapshot.data : null;
      } else {
        // Single-container path (no shared snapshot): fetch this node's once.
        const client = api || (await node.api());
        resources = await client.clusterResources('lxc');
        proxmoxReachable = true;
      }
      if (proxmoxReachable) {
        const resource = findInSnapshot(resources, container.containerId);
        if (resource) {
          inProxmox = true;
          proxmoxRunning = resource.status === 'running';
        }
      }
    } catch (err) {
      proxmoxReachable = false;
    }
  }

  // Only inspect the create job when the container isn't in Proxmox, to
  // distinguish creating / failed / missing. The create job is linked by FK
  // (creationJobId), so this is a cheap PK lookup or free when eager-loaded.
  let creating = false;
  let createFailed = false;
  if (!inProxmox) {
    const createJob = await findCreateJob(container, Job);
    creating = isActiveJob(createJob);
    createFailed = !!createJob && createJob.status === 'failure';
  }

  return decideStatus({
    proxmoxReachable,
    inProxmox,
    proxmoxRunning,
    hasVmid,
    creating,
    createFailed,
  });
}

/**
 * Compute live statuses for many containers efficiently.
 *
 * No per-container Proxmox calls and no per-container DB queries are issued:
 *   - Proxmox: containers are grouped by node so each node's
 *     `clusterResources('lxc')` snapshot is fetched exactly once.
 *   - Create job: resolved from each container's eager-loaded `creationJob`
 *     association (or its creationJobId FK).
 *
 * @param {Array<object>} containers - Container instances (each with `node`, and
 *   ideally the `creationJob` association loaded to avoid per-container queries).
 * @param {object} Job - Job model.
 * @returns {Promise<Map<number,string>>} Map of container.id -> STATUS value.
 */
async function computeContainerStatuses(containers, Job) {
  const result = new Map();

  // Group by node id (containers without a node still get resolved, just without
  // any Proxmox facts).
  const byNode = new Map();
  for (const container of containers) {
    const key = container.node ? container.node.id : `__no_node_${container.id}`;
    if (!byNode.has(key)) byNode.set(key, []);
    byNode.get(key).push(container);
  }

  await Promise.all(
    Array.from(byNode.values()).map(async (group) => {
      const node = group[0].node;
      let snapshot = { ok: false, data: null };

      if (nodeHasApiAccess(node)) {
        try {
          const api = await node.api();
          const data = await api.clusterResources('lxc');
          snapshot = { ok: true, data };
        } catch (err) {
          snapshot = { ok: false, data: null };
        }
      }

      // Resolution is now CPU-only per container (no Proxmox/DB I/O when the
      // create job is eager-loaded), so the snapshot is reused for all of them.
      for (const container of group) {
        // eslint-disable-next-line no-await-in-loop
        const status = await computeContainerStatus({ container, Job, snapshot });
        result.set(container.id, status);
      }
    }),
  );

  return result;
}

module.exports = {
  STATUS,
  STATUS_VALUES,
  computeContainerStatus,
  computeContainerStatuses,
  decideStatus,
  // exported for reuse / testing
  findInSnapshot,
  findCreateJob,
};
