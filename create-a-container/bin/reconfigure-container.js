#!/usr/bin/env node
/**
 * reconfigure-container.js
 * 
 * Background job script that applies configuration changes and restarts a container.
 * This script is executed by the job-runner when environment variables or entrypoint
 * are changed on an existing container, or when resource requests are approved.
 * 
 * Usage: node bin/reconfigure-container.js --container-id=<id> [--memory=<MB>] [--cpus=<n>] [--swap=<MB>] [--rootfs=<GB>]
 * 
 * The script will:
 * 1. Load the container record from the database
 * 2. Apply env, entrypoint, and/or resource config via Proxmox API
 * 3. Stop the container
 * 4. Start the container
 * 5. Update the container status to 'running'
 * 
 * All output is logged to STDOUT for capture by the job-runner.
 * Exit code 0 = success, non-zero = failure.
 */

const path = require('path');

// Load models from parent directory
const db = require(path.join(__dirname, '..', 'models'));
const { Container, Node, Site } = db;

// Load utilities
const { parseArgs } = require(path.join(__dirname, '..', 'utils', 'cli'));

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
    // Get the Proxmox API client
    const client = await node.api();
    console.log('Proxmox API client initialized');
    
    // Build config from environment variables and entrypoint
    const lxcConfig = container.buildLxcEnvConfig();
    
    if (Object.keys(lxcConfig).length > 0) {
      console.log('Applying LXC configuration...');
      console.log('Config:', JSON.stringify(lxcConfig, null, 2));
      await client.updateLxcConfig(node.name, container.containerId, lxcConfig);
      console.log('Configuration applied');
    } else {
      console.log('No configuration changes to apply');
    }

    // Apply resource changes if specified via CLI flags
    const resourceConfig = {};
    if (args.memory) resourceConfig.memory = parseInt(args.memory, 10);
    if (args.cpus) resourceConfig.cores = parseInt(args.cpus, 10);
    if (args.swap) resourceConfig.swap = parseInt(args.swap, 10);
    if (args.rootfs) resourceConfig.rootfs = `local-lvm:${parseInt(args.rootfs, 10)}`;

    if (Object.keys(resourceConfig).length > 0) {
      console.log('Applying resource configuration...');
      console.log('Resources:', JSON.stringify(resourceConfig, null, 2));
      await client.updateLxcConfig(node.name, container.containerId, resourceConfig);
      console.log('Resource configuration applied');
    }

    // Determine if a stop/start cycle is required.
    // rootfs (disk) changes require a restart; memory/cpu/swap are applied live via cgroups.
    // LXC env/entrypoint config changes (actual values being set, not just deletions) require a restart.
    const hasEnvConfigChanges = Object.keys(lxcConfig).some(k => k !== 'delete');
    const requiresRestart = !!args.rootfs || hasEnvConfigChanges;

    // Check container status before stop/start cycle
    const lxcStatus = await client.getLxcStatus(node.name, container.containerId);
    console.log(`Container current status: ${lxcStatus.status}`);

    if (!requiresRestart) {
      console.log('Resource changes applied live (no restart required)');
    } else {
      // Only stop if the container is running
      if (lxcStatus.status === 'running') {
        console.log('Stopping container...');
        const stopUpid = await client.stopLxc(node.name, container.containerId);
        console.log(`Stop task started: ${stopUpid}`);

        // Wait for stop to complete (shorter timeout for stop/start)
        await client.waitForTask(node.name, stopUpid, 2000, 60000);
        console.log('Container stopped');
      } else {
        console.log('Container not running, skipping stop');
      }

      // Start the container
      console.log('Starting container...');
      const startUpid = await client.startLxc(node.name, container.containerId);
      console.log(`Start task started: ${startUpid}`);

      // Wait for start to complete
      await client.waitForTask(node.name, startUpid, 2000, 60000);
      console.log('Container started');
    }
    
    if (requiresRestart) {
      // Get MAC address from config (in case it wasn't captured during failed create)
      const macAddress = await client.getLxcMacAddress(node.name, container.containerId);

      if (!macAddress) {
        throw new Error('Could not get MAC address from container configuration');
      }

      // Get IP address from Proxmox interfaces API
      const ipv4Address = await client.getLxcIpAddress(node.name, container.containerId);

      if (!ipv4Address) {
        throw new Error('Could not get IP address from Proxmox interfaces API');
      }

      // Update container record with MAC/IP and running status
      await container.update({
        status: 'running',
        macAddress,
        ipv4Address
      });

      console.log('Status updated to: running');
      console.log(`  MAC: ${macAddress}`);
      console.log(`  IP: ${ipv4Address}`);
    }
    
    console.log('Container reconfiguration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Container reconfiguration failed:', err.message);
    
    // Log axios error details if available
    if (err.response?.data) {
      console.error('API Error Details:', JSON.stringify(err.response.data, null, 2));
    }
    
    // Update status to failed
    try {
      await container.update({ status: 'failed' });
      console.log('Status updated to: failed');
    } catch (updateErr) {
      console.error('Failed to update container status:', updateErr.message);
    }
    
    process.exit(1);
  }
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
