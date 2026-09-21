#!/usr/bin/env node
/**
 * reconcile-volumes.js
 *
 * One-time (and re-runnable) reconciliation that brings every provisioned
 * container's live Proxmox mpN config in line with its Volume rows (issue #421
 * (b)). Enqueued by the backfill migration.
 *
 * For each container that has a provider id (containerId) and at least one
 * non-builtin volume, this:
 *   1. derives any missing host paths from the node storage's configured path,
 *   2. skips containers whose volumes aren't all `ready` (the create/reconfigure
 *      job owns the agent sync barrier; this reconciler never waits or mutates
 *      directories),
 *   3. sets mpN via updateLxcConfig only when the rendered config differs from
 *      what's already live — so pre-existing containers (which already carry
 *      their mp0) are a no-op.
 *
 * Best-effort and non-fatal per container: a single node/API failure is logged
 * and skipped rather than failing the whole job. Exit 0 unless something
 * unexpected throws.
 *
 * Usage: node bin/reconcile-volumes.js
 */

const path = require('path');

const db = require(path.join(__dirname, '..', 'models'));
const { Container, Node, Site, Volume } = db;
const {
  resolveVolumesRoot,
  deriveVolumeHostPaths,
} = require(path.join(__dirname, '..', 'utils', 'volumes'));

/**
 * Reconcile one container's live mpN with its Volume rows.
 * @returns {Promise<'applied'|'skipped'>} whether a mount change was applied
 */
async function reconcileContainer(container) {
  const node = container.node;
  if (!node) {
    console.log(`Container ${container.hostname}: no node, skipping`);
    return 'skipped';
  }
  if (!container.containerId) {
    console.log(`Container ${container.hostname}: not provisioned yet, skipping`);
    return 'skipped';
  }
  if (!node.hasApiAccess()) {
    console.log(`Container ${container.hostname}: node ${node.name} has no API access, skipping`);
    return 'skipped';
  }

  const volumes = await Volume.findAll({ where: { containerId: container.id }, order: [['id', 'ASC']] });
  if (volumes.length === 0) return 'skipped';

  const client = await node.api();
  const { root: volumesRoot } = await resolveVolumesRoot(client, node);

  // Backfill any missing host paths so mpN can be rendered (shared helper).
  await deriveVolumeHostPaths(volumes, {
    volumesRoot,
    hostname: container.hostname,
    nodeType: node.nodeType,
  });

  // Only reconcile once every volume directory is ready — directory creation is
  // the create/reconfigure job's responsibility (agent sync barrier), not this
  // reconciler's.
  const fresh = await Volume.findAll({ where: { containerId: container.id }, order: [['id', 'ASC']] });
  const notReady = fresh.filter((v) => v.status !== 'ready');
  if (notReady.length > 0) {
    console.log(
      `Container ${container.hostname}: ${notReady.length} volume(s) not ready, skipping mount reconcile`,
    );
    return 'skipped';
  }

  const mountConfig = Volume.buildMountConfig(fresh);
  const live = await client.lxcConfig(node.name, container.containerId);
  const differs = Object.entries(mountConfig).some(([k, val]) => live[k] !== val);
  if (!differs) {
    console.log(`Container ${container.hostname}: mounts already in sync`);
    return 'skipped';
  }

  console.log(`Container ${container.hostname}: applying ${Object.keys(mountConfig).length} mount(s)`);
  await client.updateLxcConfig(node.name, container.containerId, mountConfig);
  await Volume.update({ appliedAt: new Date() }, { where: { containerId: container.id } });
  return 'applied';
}

async function main() {
  console.log('Reconciling container volumes...');
  const containers = await Container.findAll({
    include: [{ model: Node, as: 'node', include: [{ model: Site, as: 'site' }] }],
  });

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const container of containers) {
    try {
      const result = await reconcileContainer(container);
      if (result === 'applied') applied += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.warn(`Container ${container.hostname}: reconcile failed (non-fatal): ${err.message}`);
    }
  }
  console.log(
    `Volume reconciliation complete: ${applied} applied, ${skipped} skipped (no-op), ${failed} failed`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
