#!/usr/bin/env node
/**
 * reconfigure-container.js
 * 
 * Background job script that converges an existing container onto the
 * manager's desired state and restarts it.
 *
 * Usage: node bin/reconfigure-container.js --container-id=<id>
 *
 * The script will:
 * 1. Generate the desired state (defaults + approved resources, env,
 *    entrypoint, volumes, network, features, hookscript, ...)
 * 2. Retrieve the container's current state from the provider
 * 3. Diff the two into set/delete/resize operations
 * 4. Apply the diff
 * 5. Restart the container (always) and refresh MAC/IP
 * 
 * All output is logged to STDOUT for capture by the job-runner.
 * Exit code 0 = success, non-zero = failure.
 */

const path = require('path');

// Load models from parent directory
const db = require(path.join(__dirname, '..', 'models'));
const { Container, Node, Site, Volume } = db;

// Load utilities
const { parseArgs } = require(path.join(__dirname, '..', 'utils', 'cli'));
const {
  resolveVolumesRoot,
  deriveVolumeHostPaths,
} = require(path.join(__dirname, '..', 'utils', 'volumes'));
const {
  buildDesiredState,
  readCurrentState,
  diffState,
  applyDiff,
} = require(path.join(__dirname, '..', 'utils', 'container-state'));

/**
 * Ensure this container's volume host paths are derived and their directories
 * are ready, then return the ready volumes so the caller can render mpN. Mirrors
 * the create job's prepareVolumes but for reconfigure (attaching a volume to
 * an already-provisioned container). Built-in and docker volumes never block.
 * @param {object} client
 * @param {object} node
 * @param {object} container
 * @returns {Promise<Volume[]>}
 */
async function ensureVolumesReady(client, node, container) {
  const volumes = await Volume.findAll({ where: { containerId: container.id } });
  if (volumes.length === 0) return [];

  // Resolve the volumes root only when a non-builtin volume still needs its
  // host path derived. Otherwise (only legacy built-in rows, or everything
  // already derived) skip it: resolveVolumesRoot fails on block-backed storage
  // like the default local-lvm, and a pre-#421 container whose only volume is
  // the built-in must not fail reconfigure over storage it never needs.
  const needsRoot = volumes.some((v) => !v.builtin && !v.hostPath);
  if (needsRoot) {
    const { root: volumesRoot } = await resolveVolumesRoot(client, node);
    // Derive + persist missing host paths; mark builtin/docker volumes ready
    // (shared with the create/reconcile jobs).
    await deriveVolumeHostPaths(volumes, {
      volumesRoot,
      siteId: container.siteId,
      owner: container.username,
      hostname: container.hostname,
      nodeType: node.nodeType,
    });
  }

  // Bounded wait for the agent to create any pending directories.
  const start = Date.now();
  const timeoutMs = 300000;
  for (;;) {
    const rows = await Volume.findAll({ where: { containerId: container.id } });
    const failed = rows.find((v) => v.status === 'failed');
    if (failed) {
      throw new Error(
        `Volume '${failed.name}' provisioning failed: ${failed.statusMessage || 'unknown error'}`,
      );
    }
    if (rows.every((v) => v.status === 'ready')) break;
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for volume provisioning on the node');
    }
    console.log('Waiting for volume provisioning on the node...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return Volume.findAll({ where: { containerId: container.id }, order: [['id', 'ASC']] });
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();
  
  if (!args['container-id']) {
    console.error('Usage: node reconfigure-container.js --container-id=<id>');
    process.exit(1);
  }
  
  const containerId = parseInt(args['container-id'], 10);
  console.log(`Starting container reconfiguration for container ID: ${containerId}`);
  
  // Load the container record with its node and site
  const container = await Container.findByPk(containerId, {
    include: [{
      model: Node,
      as: 'node',
      include: [{
        model: Site,
        as: 'site'
      }]
    }]
  });
  
  if (!container) {
    console.error(`Container with ID ${containerId} not found`);
    process.exit(1);
  }
  
  if (!container.containerId) {
    console.error('Container has no Proxmox VMID - cannot reconfigure');
    process.exit(1);
  }
  
  const node = container.node;
  
  if (!node) {
    console.error('Container has no associated node');
    process.exit(1);
  }
  
  console.log(`Container: ${container.hostname}`);
  console.log(`Node: ${node.name}`);
  console.log(`VMID: ${container.containerId}`);
  
  try {
    const client = await node.api();
    console.log('Node API client initialized');

    // Volume host directories must exist before mpN can be rendered.
    const volumes = await ensureVolumesReady(client, node, container);

    // 1. Desired state (shared with the create job)
    const desired = await buildDesiredState(container, node, node.site, { volumes });

    // 2. Current state
    let vmid = container.containerId;
    const current = await readCurrentState(client, node, vmid);

    // 3. Diff (throws on unsupported changes such as rootfs shrink)
    const { ops, skipped } = diffState(desired, current, client);
    if (skipped.length > 0) {
      console.log(`Keys not supported by ${node.nodeType} provider (skipped): ${skipped.join(', ')}`);
    }
    if (ops.length === 0) {
      console.log('Container already matches desired state');
    } else {
      console.log(`Applying ${ops.length} change(s):`);
      for (const o of ops) {
        const show = (v) => (o.key === 'env' ? '<env>' : JSON.stringify(v));
        console.log(`  ${o.op.padEnd(6)} ${o.key}: ${show(o.from)} -> ${show(o.to)}`);
      }
    }

    // 4. Restart is always performed for a queued reconfigure job, for
    // consistency (the UI/API only queues this job when a restart is expected).

    // 5. Apply
    if (ops.length > 0) {
      const replacedId = await applyDiff(client, node, vmid, ops);
      if (replacedId) {
        vmid = replacedId;
        await container.update({ containerId: String(vmid) });
        console.log(`Provider container ID changed to ${vmid}`);
      }
      if (ops.some((o) => /^mp\d+$/.test(o.key))) {
        await Volume.update({ appliedAt: new Date() }, { where: { containerId: container.id } });
      }
      console.log('Desired state applied');
    }

    // 6. Restart
    const lxcStatus = await client.getLxcStatus(node.name, vmid);
    console.log(`Container current status: ${lxcStatus.status}`);
    if (lxcStatus.status === 'running') {
      console.log('Stopping container...');
      const stopUpid = await client.stopLxc(node.name, vmid);
      await client.waitForTask(node.name, stopUpid, 2000, 60000);
      console.log('Container stopped');
    }
    console.log('Starting container...');
    const startUpid = await client.startLxc(node.name, vmid);
    await client.waitForTask(node.name, startUpid, 2000, 60000);
    console.log('Container started');

    const macAddress = await client.getLxcMacAddress(node.name, vmid);
    if (!macAddress) {
      throw new Error('Could not get MAC address from container configuration');
    }
    const ipv4Address = await client.getLxcIpAddress(node.name, vmid);
    if (!ipv4Address) {
      throw new Error('Could not get IP address from provider interfaces API');
    }
    await container.update({ macAddress, ipv4Address });
    console.log(`  MAC: ${macAddress}`);
    console.log(`  IP: ${ipv4Address}`);

    console.log('Container reconfiguration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Container reconfiguration failed:', err.message);
    
    // Log axios error details if available
    if (err.response?.data) {
      console.error('API Error Details:', JSON.stringify(err.response.data, null, 2));
    }

    process.exit(1);
  }
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
