'use strict';

/**
 * usage-collection.js — one polling cycle of per-container usage samples
 * (issue #440). Shared by usage-collector.js (OTLP export) and the
 * /sites/:siteId/usage report endpoint, so both see identical data.
 *
 * One Proxmox `/cluster/resources` call per cluster: after each successful
 * call, every node name appearing in the response is marked covered (within
 * the same site), so cluster peers are not re-polled. Per-node failures are
 * logged and skipped; a cycle always completes.
 *
 * Pure per-entry mapping/attribution lives in utils/usage-sample.js.
 */

const db = require('../models');
const { buildUsageSample } = require('./usage-sample');

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
 * Gather one cycle of normalized usage samples plus attribution findings.
 * @param {object} [options]
 * @param {number|null} [options.siteId] - Restrict to one site, or null for all
 * @returns {Promise<{
 *   samples: Array<object>,
 *   findings: Array<{ kind: 'drift'|'unattributed', vmid: string, tagOwner: string|null, dbOwner: string|null }>,
 *   unknownNodeRows: number,
 * }>}
 */
async function collectUsage({ siteId = null } = {}) {
  const nodeWhere = db.Node.provisionableWhere();
  if (siteId != null) nodeWhere.siteId = siteId;
  const nodes = await db.Node.findAll({ where: nodeWhere });
  if (nodes.length === 0) return { samples: [], findings: [], unknownNodeRows: 0 };

  const containerIndex = await loadContainerIndex(siteId);

  // Node lookup by `${siteId}:${name}` — cluster-resources rows carry the
  // Proxmox node name, and node names are only meaningful within a site.
  const nodesByName = new Map(nodes.map((n) => [`${n.siteId}:${n.name}`, n]));
  const covered = new Set();

  const samples = [];
  const findings = [];
  let unknownNodeRows = 0;

  for (const node of nodes) {
    const nodeKey = `${node.siteId}:${node.name}`;
    if (covered.has(nodeKey)) continue;
    covered.add(nodeKey);

    let resources;
    try {
      const api = await node.api();
      resources = await api.clusterResources('lxc');
    } catch (err) {
      console.error(`UsageCollection: node ${node.name} (site ${node.siteId}) unreachable: ${err.message}`);
      continue;
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
      if (finding) findings.push(finding);
    }
  }

  return { samples, findings, unknownNodeRows };
}

module.exports = { collectUsage };
