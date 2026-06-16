/**
 * container-status.js — resolve the *live* status of a container.
 *
 * Historically the container "status" was a static column in the database that
 * was only mutated by the create/reconfigure job scripts. That value drifts out
 * of reality whenever something changes a container directly in Proxmox (or when
 * a job dies without updating the row). This module computes the real status on
 * demand by combining three sources of truth:
 *
 *   1. Proxmox  — does the LXC exist, and is it running or stopped?
 *   2. Jobs     — is there an active create/restart job, or did the last create
 *                 job fail?
 *   3. Config   — does the live LXC config match what the API server expects?
 *
 * Resolved statuses (a strict superset of the old running/offline values):
 *   running      — exists in Proxmox and is online
 *   offline      — exists in Proxmox but is stopped
 *   restarting   — has an active (pending/running) reconfigure job
 *   creating     — not in Proxmox, but has an active (pending/running) create job
 *   failed       — not in Proxmox, last create job returned failure
 *   missing      — not in Proxmox, create job succeeded or no create job found
 *   out-of-sync  — exists in Proxmox but its config doesn't match expectation
 *   unknown      — Proxmox could not be reached / node has no API credentials
 */

const { Op } = require('sequelize');

const STATUS = Object.freeze({
  RUNNING: 'running',
  OFFLINE: 'offline',
  CREATING: 'creating',
  RESTARTING: 'restarting',
  FAILED: 'failed',
  MISSING: 'missing',
  OUT_OF_SYNC: 'out-of-sync',
  UNKNOWN: 'unknown',
});

const STATUS_VALUES = Object.freeze(Object.values(STATUS));

// Job command fragments that identify create vs reconfigure (restart) jobs.
// Jobs are distinguished solely by their `command` string (no type column).
const CREATE_CMD = 'bin/create-container.js';
const RECONFIGURE_CMD = 'bin/reconfigure-container.js';

const ACTIVE_JOB_STATUSES = ['pending', 'running'];

function nodeHasCreds(node) {
  return !!(node && node.apiUrl && node.tokenId && node.secret);
}

/**
 * Escape a string for safe use inside a RegExp.
 * @param {string|number} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the most recent job for a container whose command contains
 * `<cmdFragment> --container-id=<id>` as a *whole* argument.
 *
 * A plain SQL LIKE on `--container-id=<id>` would also match longer ids
 * (id 12 matches `--container-id=123`), so we use LIKE only to narrow at the DB
 * level (ordered most-recent first) and then confirm each candidate in JS with a
 * regex requiring the id to be terminated by a space or end-of-string.
 *
 * @param {object} Job - Job model
 * @param {string} cmdFragment - e.g. CREATE_CMD or RECONFIGURE_CMD
 * @param {number} id - Container database id
 * @returns {Promise<object|null>}
 */
async function findLatestJobForContainer(Job, cmdFragment, id) {
  const candidates = await Job.findAll({
    where: { command: { [Op.like]: `%${cmdFragment} --container-id=${id}%` } },
    order: [['createdAt', 'DESC']],
  });
  const whole = new RegExp(`${escapeRegExp(cmdFragment)} --container-id=${escapeRegExp(id)}(?:\\s|$)`);
  return candidates.find((job) => whole.test(job.command)) || null;
}

/**
 * Find the most recent create job for a container.
 * Prefers the explicit creationJobId FK; falls back to a command-string match.
 * @param {object} container - Container instance (with optional creationJob assoc)
 * @param {object} Job - Job model
 * @returns {Promise<object|null>}
 */
async function findLatestCreateJob(container, Job) {
  if (container.creationJob) return container.creationJob;
  if (container.creationJobId) {
    return Job.findByPk(container.creationJobId);
  }
  return findLatestJobForContainer(Job, CREATE_CMD, container.id);
}

/**
 * Find the most recent reconfigure (restart) job for a container, if any.
 * @param {object} container - Container instance
 * @param {object} Job - Job model
 * @returns {Promise<object|null>}
 */
async function findLatestReconfigureJob(container, Job) {
  return findLatestJobForContainer(Job, RECONFIGURE_CMD, container.id);
}

function isActiveJob(job) {
  return !!job && ACTIVE_JOB_STATUSES.includes(job.status);
}

/**
 * Parse a NUL-separated Proxmox env string ("K=V\0K2=V2") into an object.
 * @param {string|null|undefined} envStr
 * @returns {Object<string,string>}
 */
function parseEnvString(envStr) {
  const out = {};
  if (!envStr) return out;
  for (const pair of String(envStr).split('\0')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.substring(0, eq)] = pair.substring(eq + 1);
  }
  return out;
}

function shallowEqualMap(a, b) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Compare the env/entrypoint the API server expects against the live LXC config.
 *
 * The expectation is built the same way the reconfigure job builds it
 * (`container.buildLxcEnvConfig()`), so this mirrors exactly what *would* be sent
 * to Proxmox. Env is compared as an unordered set of key=value pairs because the
 * Proxmox API does not preserve ordering. Returns true when the live config
 * matches the expectation (i.e. in sync).
 *
 * @param {object} container - Container instance (provides buildLxcEnvConfig)
 * @param {object} liveConfig - Result of ProxmoxApi.lxcConfig(node, vmid)
 * @returns {boolean} true if in sync, false if drifted
 */
function configMatches(container, liveConfig) {
  const expected =
    typeof container.buildLxcEnvConfig === 'function' ? container.buildLxcEnvConfig() : {};
  const expectedDeletes = new Set(
    (expected.delete ? String(expected.delete).split(',') : []).map((s) => s.trim()),
  );

  // --- entrypoint ---
  const liveEntrypoint = liveConfig?.entrypoint || null;
  if (expectedDeletes.has('entrypoint')) {
    if (liveEntrypoint) return false; // expected absent, but present live
  } else if ((expected.entrypoint || null) !== liveEntrypoint) {
    return false;
  }

  // --- env ---
  const liveEnv = parseEnvString(liveConfig?.env);
  if (expectedDeletes.has('env')) {
    if (Object.keys(liveEnv).length > 0) return false; // expected none, but some live
  } else {
    const expectedEnv = parseEnvString(expected.env);
    if (!shallowEqualMap(expectedEnv, liveEnv)) return false;
  }

  return true;
}

/**
 * Locate a container in a cluster-resources snapshot by VMID.
 * @param {Array<object>|null} snapshot - Result of ProxmoxApi.clusterResources('lxc')
 * @param {number} vmid
 * @returns {object|null} The matching resource entry or null
 */
function findInSnapshot(snapshot, vmid) {
  if (!Array.isArray(snapshot) || vmid == null) return null;
  return snapshot.find((r) => Number(r.vmid) === Number(vmid)) || null;
}

/**
 * Resolve status from already-gathered facts. Pure function — no I/O — so it is
 * trivial to unit test and is the single source of the decision tree.
 *
 * @param {object} facts
 * @param {boolean} facts.proxmoxReachable - Whether Proxmox was queried OK.
 * @param {boolean} facts.inProxmox - Whether the LXC exists in Proxmox.
 * @param {boolean} facts.proxmoxRunning - Whether the LXC is running.
 * @param {boolean} facts.inSync - Whether the live config matches expectation.
 * @param {boolean} facts.hasVmid - Whether the container has a Proxmox VMID.
 * @param {boolean} facts.creating - Active create job present.
 * @param {boolean} facts.restarting - Active reconfigure job present.
 * @param {boolean} facts.createFailed - Latest create job returned failure.
 * @param {boolean} facts.hasCreateJob - A create job exists at all.
 * @returns {string} STATUS value
 */
function decideStatus(facts) {
  if (facts.inProxmox) {
    if (facts.restarting) return STATUS.RESTARTING;
    if (facts.inSync === false) return STATUS.OUT_OF_SYNC;
    return facts.proxmoxRunning ? STATUS.RUNNING : STATUS.OFFLINE;
  }

  if (facts.creating) return STATUS.CREATING;
  if (facts.restarting) return STATUS.RESTARTING;

  // We had a VMID + creds but couldn't reach Proxmox: don't guess missing.
  if (facts.hasVmid && !facts.proxmoxReachable) return STATUS.UNKNOWN;

  if (facts.createFailed) return STATUS.FAILED;
  return STATUS.MISSING;
}

/**
 * Compute the live status of a single container.
 *
 * @param {object} params
 * @param {object} params.container - Container instance (with `node` association).
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
  const hasCreds = nodeHasCreds(node);
  const hasVmid = container.containerId != null;

  let client = api || null;
  async function getClient() {
    if (!client) client = await node.api();
    return client;
  }

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
        const c = await getClient();
        resources = await c.clusterResources('lxc');
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

  // --- Jobs ---
  const reconfigureJob = await findLatestReconfigureJob(container, Job);
  const restarting = isActiveJob(reconfigureJob);

  // Drift detection (only meaningful if it exists and isn't already restarting).
  let inSync = null;
  if (inProxmox && !restarting && hasCreds) {
    try {
      const c = await getClient();
      const liveConfig = await c.lxcConfig(node.name, container.containerId);
      inSync = configMatches(container, liveConfig);
    } catch (err) {
      inSync = null; // can't assert drift
    }
  }

  // Only look up the create job when we actually need it (container not running
  // in Proxmox), to avoid an extra query on the happy path.
  let creating = false;
  let createFailed = false;
  let hasCreateJob = false;
  if (!inProxmox) {
    const createJob = await findLatestCreateJob(container, Job);
    hasCreateJob = !!createJob;
    creating = isActiveJob(createJob);
    createFailed = !!createJob && createJob.status === 'failure';
  }

  return decideStatus({
    proxmoxReachable,
    inProxmox,
    proxmoxRunning,
    inSync,
    hasVmid,
    creating,
    restarting,
    createFailed,
    hasCreateJob,
  });
}

/**
 * Compute live statuses for many containers efficiently.
 *
 * Groups containers by node so each node's Proxmox `clusterResources('lxc')`
 * snapshot is fetched exactly once and a single authenticated client is reused
 * for that node's containers (including per-container config reads). This keeps
 * total end-user latency low for the list page versus N independent calls.
 *
 * @param {Array<object>} containers - Container instances (each with `node`).
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
      let api = null;
      let snapshot = { ok: false, data: null };

      if (nodeHasCreds(node)) {
        try {
          api = await node.api();
          const data = await api.clusterResources('lxc');
          snapshot = { ok: true, data };
        } catch (err) {
          snapshot = { ok: false, data: null };
        }
      }

      // Resolve each container in the group sequentially per node (shares the
      // single authenticated client); different nodes run in parallel.
      for (const container of group) {
        // eslint-disable-next-line no-await-in-loop
        const status = await computeContainerStatus({ container, Job, api, snapshot });
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
  configMatches,
  parseEnvString,
  findInSnapshot,
  findLatestCreateJob,
  findLatestReconfigureJob,
};
