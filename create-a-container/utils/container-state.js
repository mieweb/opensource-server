/**
 * container-state.js
 *
 * Single source of truth for the configuration a managed container SHOULD have
 * (its "desired state"), plus helpers to read the provider's current state,
 * diff the two, and apply the diff.
 *
 * Both the create job and the reconfigure job derive their config from
 * buildDesiredState(), so any change to the manager's defaults (e.g. resource
 * defaults, LXC features) propagates to existing containers the next time they
 * are reconfigured.
 *
 * Desired/current state shape (all keys optional on `current`):
 *   {
 *     config: { [lxcKey]: string|number|null },  // null => key must be unset
 *     rootfsGb: number|null,
 *   }
 */

const NVIDIA_HOOKSCRIPT = 'local:snippets/nvidia';
const LXC_FEATURES = 'nesting=1,keyctl=1,fuse=1';

/**
 * Parse the disk size in gigabytes from a Proxmox LXC `rootfs` config value.
 * Example input: "local-lvm:vm-123-disk-0,size=50G" → 50
 * @param {string} [rootfs]
 * @returns {number|null}
 */
function parseRootfsSizeGb(rootfs) {
  if (!rootfs) return null;
  const match = /size=(\d+(?:\.\d+)?)([TGMK])?/i.exec(rootfs);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'G').toUpperCase();
  const gb = { T: value * 1024, G: value, M: value / 1024, K: value / (1024 * 1024) }[unit];
  return Number.isFinite(gb) ? Math.round(gb) : null;
}

/**
 * Extract the provider container ID from a Docker pseudo task id
 * ("docker:<kind>:<id>"). Returns null for anything else.
 */
function parseDockerTaskId(taskId, expectedKind = null) {
  if (typeof taskId !== 'string') return null;
  const parts = taskId.split(':');
  if (parts[0] !== 'docker' || parts.length < 3) return null;
  if (expectedKind && parts[1] !== expectedKind) return null;
  return parts.slice(2).join(':');
}

/** Parse a comma-separated `k=v` Proxmox property string into an ordered map. */
function parsePropertyString(str) {
  const out = {};
  if (!str || typeof str !== 'string') return out;
  for (const part of str.split(',')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) out[part] = '';
    else out[part.substring(0, eq)] = part.substring(eq + 1);
  }
  return out;
}

function formatPropertyString(map) {
  return Object.entries(map)
    .map(([k, v]) => (v === '' ? k : `${k}=${v}`))
    .join(',');
}

/** Parse a NUL-separated env string into a { KEY: value } map. */
function parseEnvString(envStr) {
  const out = {};
  if (!envStr || typeof envStr !== 'string') return out;
  for (const pair of envStr.split('\0')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.substring(0, eq)] = pair.substring(eq + 1);
  }
  return out;
}

function sameMap(a, b) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && String(a[k]) === String(b[k]));
}

const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isEmpty = (v) => v === undefined || v === null || v === '';

/**
 * Pure desired-state computation. Kept free of DB access for testability; see
 * buildDesiredState() for the async wrapper that gathers the inputs.
 *
 * @param {object} p
 * @param {object} p.container - Container (hostname, username, nvidiaRequested)
 * @param {object} p.node - Node (networkBridge)
 * @param {object} p.site - Site (internalDomain)
 * @param {object} p.resourceDefaults - ResourceRequest.RESOURCE_DEFAULTS
 * @param {object} p.approved - Approved resources by type
 * @param {object} p.envConfig - Output of buildLxcEnvConfig({ deleteMissing: true })
 * @param {object} [p.mounts] - mpN config from Volume.buildMountConfig
 * @param {number} [p.reservedMounts] - Count of legacy built-in mpN slots to leave alone
 */
function computeDesiredState({
  container,
  node,
  site,
  resourceDefaults,
  approved = {},
  envConfig = {},
  mounts = {},
  reservedMounts = 0,
}) {
  // Swap may legitimately be 0; every other resource must be positive. A
  // nonpositive approval (possible via auto-approve, and possibly already
  // persisted) would otherwise reach the provider as "unlimited" (Docker) or be
  // rejected (Proxmox), so fall back to the default for those.
  const resources = { ...resourceDefaults };
  for (const [k, raw] of Object.entries(approved)) {
    if (raw === undefined || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    if (k === 'swap' ? v < 0 : v <= 0) continue;
    resources[k] = v;
  }

  const deleted = String(envConfig.delete || '').split(',').filter(Boolean);
  const config = {
    cores: Number(resources.cpus),
    memory: Number(resources.memory),
    swap: Number(resources.swap),
    features: LXC_FEATURES,
    net0: `name=eth0,ip=dhcp,bridge=${node.networkBridge}`,
    searchdomain: site.internalDomain,
    onboot: 1,
    tags: container.username,
    hookscript: container.nvidiaRequested ? NVIDIA_HOOKSCRIPT : null,
    env: deleted.includes('env') ? null : envConfig.env ?? null,
    entrypoint: deleted.includes('entrypoint') ? null : envConfig.entrypoint ?? null,
    ...mounts,
  };

  return {
    config,
    rootfsGb: Number(resources.rootfs),
    reservedMounts,
    // Matches this container's manager-created volume host paths
    // (<root>/site-<siteId>/<owner>/<hostname>/<name>, see
    // containerVolumeHostPath in utils/volumes.js). The owner segment is a
    // wildcard because paths keep the ORIGINAL owner after an ownership
    // transfer; (siteId, hostname) is unique (containers_site_hostname_unique).
    // Only unlisted mpN matching it are treated as detached.
    managedMountPattern: new RegExp(`/site-${site.id}/[^/]+/${escapeRegExp(container.hostname)}/[^/]+$`),
  };
}

/**
 * Gather everything needed and compute the desired state for a container.
 * @param {object} container - Container model instance
 * @param {object} node - Node model instance
 * @param {object} site - Site model instance
 * @param {object} [options]
 * @param {Array} [options.volumes] - Volume rows to mount (defaults to none;
 *   callers pass their ready volumes so mounts are only rendered once ready)
 */
async function buildDesiredState(container, node, site, { volumes = [] } = {}) {
  // Lazy-require so the pure helpers above can be unit-tested without a DB.
  const { ResourceRequest, Volume } = require('../models');
  const approved = await ResourceRequest.getApprovedResources(site.id, container.hostname, container.username);
  const envConfig = await container.buildLxcEnvConfig({ deleteMissing: true });
  return computeDesiredState({
    container,
    node,
    site,
    resourceDefaults: ResourceRequest.RESOURCE_DEFAULTS,
    approved,
    envConfig,
    mounts: Volume.buildMountConfig(volumes),
    reservedMounts: volumes.filter((v) => v.builtin).length,
  });
}

/**
 * Flat create/clone-time config (no deletes, no env/entrypoint/mounts/hookscript,
 * which are applied in later steps of the create job).
 */
function toLxcConfig(desired) {
  const { cores, memory, swap, features, net0, searchdomain, onboot, tags } = desired.config;
  return { cores, memory, swap, features, net0, searchdomain, onboot, tags };
}

/**
 * Keys a client can report/apply. Providers may expose `supportsConfigKey(key)`
 * (e.g. Docker cannot represent swap/features/hookscript); default is all keys.
 */
function clientSupports(client, key) {
  return typeof client.supportsConfigKey === 'function' ? client.supportsConfigKey(key) : true;
}

/**
 * Read the provider's current config for a container.
 * @returns {Promise<{config: object, rootfsGb: number|null}>}
 */
async function readCurrentState(client, node, vmid) {
  const config = (await client.lxcConfig(node.name, vmid)) || {};
  return { config, rootfsGb: parseRootfsSizeGb(config.rootfs) };
}

/** Compare a single key; returns true when current already matches desired. */
function keyMatches(key, desired, current) {
  if (desired === null) return isEmpty(current);
  if (isEmpty(current)) return false;
  switch (key) {
    case 'env':
      return sameMap(parseEnvString(desired), parseEnvString(current));
    case 'features':
      return sameMap(parsePropertyString(desired), parsePropertyString(current));
    case 'net0': {
      const d = parsePropertyString(desired);
      const c = parsePropertyString(current);
      return Object.keys(d).every((k) => String(c[k]) === String(d[k]));
    }
    default:
      return String(desired).trim() === String(current).trim();
  }
}

/**
 * Compute the operations needed to move `current` to `desired`.
 * @returns {{ops: Array<{key: string, op: 'set'|'delete'|'resize', from: any, to: any}>, skipped: string[]}}
 * @throws {Error} when the desired rootfs is smaller than the current one
 */
function diffState(desired, current, client = {}) {
  const ops = [];
  const cur = current.config || {};
  const skipped = [];

  for (const [key, want] of Object.entries(desired.config)) {
    if (!clientSupports(client, key)) {
      skipped.push(key);
      continue;
    }
    const have = cur[key];
    if (keyMatches(key, want, have)) continue;
    // Only remove a hookscript the manager installed; template/provider
    // lifecycle hooks are left alone.
    if (key === 'hookscript' && want === null && have !== NVIDIA_HOOKSCRIPT) continue;

    if (want === null) {
      ops.push({ key, op: 'delete', from: have, to: null });
    } else if (key === 'net0' && !isEmpty(have)) {
      // Preserve provider-assigned properties (hwaddr, type, firewall...) so the
      // MAC address and DHCP lease survive the rewrite.
      const merged = { ...parsePropertyString(have), ...parsePropertyString(want) };
      ops.push({ key, op: 'set', from: have, to: formatPropertyString(merged) });
    } else {
      ops.push({ key, op: 'set', from: have, to: want });
    }
  }

  // Detached volumes: an mpN the desired state no longer lists is only removed
  // when its host path is one of this container's manager-created volume
  // directories. Mounts inherited from a template (or added on the provider)
  // are preserved, as are the reserved legacy built-in slots.
  const reserved = desired.reservedMounts || 0;
  const managed = desired.managedMountPattern;
  for (const key of Object.keys(cur)) {
    const m = /^mp(\d+)$/.exec(key);
    if (!m || Number(m[1]) < reserved || key in desired.config) continue;
    const hostPath = String(cur[key]).split(',')[0];
    if (!managed || !managed.test(hostPath)) continue;
    if (!clientSupports(client, key)) continue;
    ops.push({ key, op: 'delete', from: cur[key], to: null });
  }

  if (clientSupports(client, 'rootfs') && desired.rootfsGb != null && current.rootfsGb != null) {
    if (desired.rootfsGb < current.rootfsGb) {
      throw new Error(
        `Desired rootfs size ${desired.rootfsGb}G is smaller than current ${current.rootfsGb}G; shrinking is not supported`,
      );
    }
    if (desired.rootfsGb > current.rootfsGb) {
      ops.push({ key: 'rootfs', op: 'resize', from: current.rootfsGb, to: desired.rootfsGb });
    }
  }

  return { ops, skipped };
}

/**
 * Apply a diff to a container.
 * @returns {Promise<string|null>} New provider container ID if the provider
 *   replaced the container (Docker recreate), otherwise null.
 */
async function applyDiff(client, node, vmid, ops) {
  let newId = null;
  const update = {};
  const deletes = [];
  for (const o of ops) {
    if (o.op === 'set') update[o.key] = o.to;
    else if (o.op === 'delete') deletes.push(o.key);
  }
  if (deletes.length > 0) update.delete = deletes.join(',');

  let id = vmid;
  if (Object.keys(update).length > 0) {
    const result = await client.updateLxcConfig(node.name, id, update);
    const replaced = parseDockerTaskId(result, 'recreate');
    if (replaced && replaced !== String(id)) {
      newId = replaced;
      id = replaced;
    }
  }

  const resize = ops.find((o) => o.op === 'resize');
  if (resize) {
    const upid = await client.resizeLxcDisk(node.name, id, 'rootfs', `${resize.to}G`);
    if (upid && typeof client.waitForTask === 'function') {
      await client.waitForTask(node.name, upid);
    }
  }

  return newId;
}

module.exports = {
  NVIDIA_HOOKSCRIPT,
  LXC_FEATURES,
  parseRootfsSizeGb,
  parseDockerTaskId,
  parsePropertyString,
  computeDesiredState,
  buildDesiredState,
  toLxcConfig,
  readCurrentState,
  diffState,
  applyDiff,
};
