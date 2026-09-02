'use strict';

/**
 * usage-collection.js — one polling cycle of per-container usage samples
 * (issue #440), backing the /sites/:siteId/usage report endpoint
 * (resources/usage).
 *
 * One Proxmox `/cluster/resources` call per cluster for LXCs plus one for
 * node capacity: after each successful call, every node name appearing in the
 * response is marked covered (within the same site), so cluster peers are not
 * re-polled. Per-node failures are logged and skipped; a cycle always
 * completes. A second, budget-capped pass probes `rrddata` PSI for the
 * highest-utilization containers (utils/usage-psi.js) — never the whole
 * fleet.
 *
 * Pure per-entry mapping/attribution lives in utils/usage-sample.js.
 */

const db = require('../models');
const { buildUsageSample } = require('./usage-sample');
const { selectPsiCandidates, latestPsi } = require('./usage-psi');

// PSI probes are one API call per container; the per-cycle fan-out is capped
// by the admin 'usage_psi_probe_limit' setting (Settings page), this default
// when unset.
const DEFAULT_PSI_PROBE_LIMIT = 16;

async function getPsiProbeLimit() {
  const parsed = parseInt(await db.Setting.get('usage_psi_probe_limit'), 10);
  return Number.isNaN(parsed) || parsed < 0 ? DEFAULT_PSI_PROBE_LIMIT : parsed;
}

/**
 * Load every DB container that exists in Proxmox, keyed by `${nodeId}:${vmid}`
 * for O(1) attribution lookups against cluster-resources entries.
 * @param {number|null} siteId - Restrict to one site, or null for all
 * @returns {Promise<Map<string, object>>}
 */
async function loadContainerIndex(siteId) {
  const where = { containerId: { [db.Sequelize.Op.ne]: null } };
  if (siteId != null) where.siteId = siteId;
  const containers = await db.Container.findAll({
    where,
    attributes: ['id', 'containerId', 'nodeId', 'username'],
  });
  const index = new Map();
  for (const c of containers) {
    index.set(`${c.nodeId}:${c.containerId}`, c);
  }
  return index;
}

/**
 * Gather one cycle of normalized usage samples, attribution findings, and
 * cluster capacity, then enrich the highest-utilization containers with PSI.
 * @param {object} [options]
 * @param {number|null} [options.siteId] - Restrict to one site, or null for all
 * @param {number|null} [options.psiProbeLimit] - Max rrddata calls this cycle
 *   (0 disables); null reads the 'usage_psi_probe_limit' admin setting
 * @returns {Promise<{
 *   samples: Array<object>,
 *   findings: Array<{ kind: 'drift'|'unattributed', vmid: string, tagOwner: string|null, dbOwner: string|null }>,
 *   unknownNodeRows: number,
 *   capacity: { cpuCores: number, memBytes: number, diskBytes: number },
 * }>}
 */
async function collectUsage({ siteId = null, psiProbeLimit = null } = {}) {
  const nodeWhere = db.Node.provisionableWhere();
  if (siteId != null) nodeWhere.siteId = siteId;
  const nodes = await db.Node.findAll({ where: nodeWhere });
  const capacity = { cpuCores: 0, memBytes: 0, diskBytes: 0 };
  if (nodes.length === 0) return { samples: [], findings: [], unknownNodeRows: 0, capacity };

  const containerIndex = await loadContainerIndex(siteId);

  // Node lookup by `${siteId}:${name}` — cluster-resources rows carry the
  // Proxmox node name, and node names are only meaningful within a site.
  const nodesByName = new Map(nodes.map((n) => [`${n.siteId}:${n.name}`, n]));
  const covered = new Set();

  const samples = [];
  const findings = [];
  // API clients per sample, for the PSI probe pass below.
  const apiBySample = new Map();
  let unknownNodeRows = 0;

  for (const node of nodes) {
    const nodeKey = `${node.siteId}:${node.name}`;
    if (covered.has(nodeKey)) continue;
    covered.add(nodeKey);

    let api;
    let resources;
    let nodeRows;
    try {
      api = await node.api();
      resources = await api.clusterResources('lxc');
      nodeRows = await api.clusterResources('node');
    } catch (err) {
      console.error(`UsageCollection: node ${node.name} (site ${node.siteId}) unreachable: ${err.message}`);
      continue;
    }

    // Cluster capacity from the node rows (each cluster contributes once).
    for (const row of Array.isArray(nodeRows) ? nodeRows : []) {
      covered.add(`${node.siteId}:${row.node}`);
      capacity.cpuCores += row.maxcpu || 0;
      capacity.memBytes += row.maxmem || 0;
      capacity.diskBytes += row.maxdisk || 0;
    }

    if (!Array.isArray(resources)) continue;

    for (const resource of resources) {
      if (resource.vmid == null) continue;
      const resourceNodeKey = `${node.siteId}:${resource.node}`;
      covered.add(resourceNodeKey);

      const dbNode = nodesByName.get(resourceNodeKey);
      if (!dbNode) {
        // Cluster member not registered in the DB — no site/node to attribute
        // the sample to; count it so the drift is visible to callers.
        unknownNodeRows++;
        continue;
      }

      const container = containerIndex.get(`${dbNode.id}:${resource.vmid}`) || null;
      const { sample, finding } = buildUsageSample({ resource, node: dbNode, container });
      samples.push(sample);
      apiBySample.set(sample, api);
      if (finding) findings.push(finding);
    }
  }

  await probePsi(samples, apiBySample, psiProbeLimit ?? (await getPsiProbeLimit()));

  return { samples, findings, unknownNodeRows, capacity };
}

/**
 * Tier-2 PSI pass: probe `rrddata` for the highest-utilization running
 * containers (budget-capped) and fill in their psi* sample fields in place.
 * Probe failures are logged and leave the sample's PSI null.
 * @param {Array<object>} samples
 * @param {Map<object, object>} apiBySample - Sample -> API client that reported it
 * @param {number} limit
 */
async function probePsi(samples, apiBySample, limit) {
  const candidates = selectPsiCandidates(samples, limit);
  await Promise.all(candidates.map(async (sample) => {
    const api = apiBySample.get(sample);
    if (!api || typeof api.rrdData !== 'function') return;
    try {
      const rows = await api.rrdData(sample.node, sample.vmid, 'hour');
      const psi = latestPsi(rows);
      if (psi) Object.assign(sample, psi);
    } catch (err) {
      console.error(`UsageCollection: PSI probe failed for CT ${sample.vmid} on ${sample.node}: ${err.message}`);
    }
  }));
}

module.exports = { collectUsage };
