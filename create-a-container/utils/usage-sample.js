'use strict';

/**
 * usage-sample.js — pure helpers for the usage collector (issue #440).
 *
 * Turns one Proxmox `/cluster/resources` LXC entry into a normalized usage
 * sample and performs owner attribution: the Proxmox tag is the primary source
 * (it lives on the container itself and survives DB loss), cross-checked
 * against Container.username. Divergence between the two is reported as
 * attribution drift.
 *
 * No I/O here — everything is a pure function so it is trivially unit-tested;
 * usage-collector.js owns the polling, DB lookups, and OTLP emission.
 */

/**
 * Extract the owner from a Proxmox `tags` field. create-container.js and the
 * owner-change path in routers/api/v1/containers.js write the owner username
 * as the container's tag; Proxmox stores tags as a `;`-separated list, so the
 * first tag is the owner.
 * @param {string|null|undefined} tags - Raw `tags` value from /cluster/resources
 * @returns {string|null} Owner username, or null when untagged
 */
function parseOwnerTag(tags) {
  if (!tags || typeof tags !== 'string') return null;
  const first = tags.split(';').map((t) => t.trim()).find((t) => t.length > 0);
  return first || null;
}

/**
 * Convert Proxmox's `cpu` field (utilization as a fraction of the container's
 * allocated cores) into cores in use.
 * @param {number|undefined} cpu - Fraction 0..1 of maxcpu
 * @param {number|undefined} maxcpu - Allocated cores
 * @returns {number|null} Cores in use
 */
function cpuCoresUsed(cpu, maxcpu) {
  if (typeof cpu !== 'number' || typeof maxcpu !== 'number') return null;
  return cpu * maxcpu;
}

/**
 * Coerce an optional numeric API field, mapping absent/invalid to null so
 * sparse sources (e.g. DummyApi snapshots) yield omitted metrics, not NaN.
 * @param {*} value
 * @returns {number|null}
 */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Build one normalized usage sample (plus any attribution finding) from a
 * cluster-resources LXC entry.
 *
 * Owner resolution: Proxmox tag if present, else the DB container's username.
 * When both exist and disagree, the tag wins and a `drift` finding is
 * returned. When neither exists an `unattributed` finding is returned.
 *
 * Metric semantics: `cpuUsed`/`memUsed`/`diskUsed` and their `*Alloc`
 * counterparts are point-in-time gauges; `diskReadBytes`/`diskWriteBytes`/
 * `netInBytes`/`netOutBytes` are cumulative counters since container boot
 * (monotonic sums — a decrease means the container rebooted).
 *
 * @param {object} params
 * @param {object} params.resource - One `/cluster/resources` entry (type lxc)
 * @param {object} params.node - DB Node the entry belongs to (name, siteId)
 * @param {object|null} params.container - Matching DB Container row, if any
 * @returns {{ sample: object, finding: { kind: 'drift'|'unattributed', vmid: string, tagOwner: string|null, dbOwner: string|null }|null }}
 */
function buildUsageSample({ resource, node, container }) {
  const tagOwner = parseOwnerTag(resource.tags);
  const dbOwner = container ? container.username : null;
  const owner = tagOwner || dbOwner;

  let finding = null;
  if (tagOwner && dbOwner && tagOwner !== dbOwner) {
    finding = { kind: 'drift', vmid: String(resource.vmid), tagOwner, dbOwner };
  } else if (!owner) {
    finding = { kind: 'unattributed', vmid: String(resource.vmid), tagOwner, dbOwner };
  }

  const sample = {
    vmid: String(resource.vmid),
    name: resource.name || null,
    owner,
    // DB primary key when the container is registered in the manager — used
    // by the report endpoint to honour per-container sharing visibility.
    containerDbId: container ? container.id : null,
    node: node.name,
    siteId: node.siteId,
    status: resource.status || null,
    cpuUsed: cpuCoresUsed(resource.cpu, resource.maxcpu),
    cpuAlloc: numberOrNull(resource.maxcpu),
    memUsed: numberOrNull(resource.mem),
    memAlloc: numberOrNull(resource.maxmem),
    diskUsed: numberOrNull(resource.disk),
    diskAlloc: numberOrNull(resource.maxdisk),
    diskReadBytes: numberOrNull(resource.diskread),
    diskWriteBytes: numberOrNull(resource.diskwrite),
    netInBytes: numberOrNull(resource.netin),
    netOutBytes: numberOrNull(resource.netout),
    uptime: numberOrNull(resource.uptime),
  };

  return { sample, finding };
}

module.exports = {
  parseOwnerTag,
  cpuCoresUsed,
  buildUsageSample,
};
