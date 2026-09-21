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
  containerVolumeHostPath,
  quickAndDirtyVolumeSpec,
} = require(path.join(__dirname, '..', 'utils', 'volumes'));

async function reconcileContainer(container) {
  const node = container.node;
  if (!node) {
    console.log(`Container ${container.hostname}: no node, skipping`);
    return;
  }
  if (!container.containerId) {
    console.log(`Container ${container.hostname}: not provisioned yet, skipping`);
    return;
  }
  if (!node.hasApiAccess()) {
    console.log(`Container ${container.hostname}: node ${node.name} has no API access, skipping`);
    return;
  }

  const volumes = await Volume.findAll({ where: { containerId: container.id }, order: [['id', 'ASC']] });
  if (volumes.length === 0) return;

  const client = await node.api();
  const { root: volumesRoot } = await resolveVolumesRoot(client, node);

  // Backfill any missing host paths so mpN can be rendered.
  for (const v of volumes) {
    if (!v.hostPath) {
      const hostPath = v.builtin
        ? quickAndDirtyVolumeSpec(volumesRoot).hostPath
        : containerVolumeHostPath(volumesRoot, container.hostname, v.name);
      await v.update({ hostPath });
    }
  }

  // Only reconcile once every volume directory is ready — directory creation is
  // the create/reconfigure job's responsibility (agent sync barrier), not this
  // reconciler's.
  const notReady = volumes.filter((v) => v.status !== 'ready');
  if (notReady.length > 0) {
    console.log(
      `Container ${container.hostname}: ${notReady.length} volume(s) not ready, skipping mount reconcile`,
    );
    return;
  }

  const fresh = await Volume.findAll({ where: { containerId: container.id }, order: [['id', 'ASC']] });
  const mountConfig = Volume.buildMountConfig(fresh);
  const live = await client.lxcConfig(node.name, container.containerId);
  const differs = Object.entries(mountConfig).some(([k, val]) => live[k] !== val);
  if (!differs) {
    console.log(`Container ${container.hostname}: mounts already in sync`);
    return;
  }

  console.log(`Container ${container.hostname}: applying ${Object.keys(mountConfig).length} mount(s)`);
  await client.updateLxcConfig(node.name, container.containerId, mountConfig);
  await Volume.update({ appliedAt: new Date() }, { where: { containerId: container.id } });
}

async function main() {
  console.log('Reconciling container volumes...');
  const containers = await Container.findAll({
    include: [{ model: Node, as: 'node', include: [{ model: Site, as: 'site' }] }],
  });

  let reconciled = 0;
  let failed = 0;
  for (const container of containers) {
    try {
      await reconcileContainer(container);
      reconciled += 1;
    } catch (err) {
      failed += 1;
      console.warn(`Container ${container.hostname}: reconcile failed (non-fatal): ${err.message}`);
    }
  }
  console.log(`Volume reconciliation complete: ${reconciled} processed, ${failed} failed`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
