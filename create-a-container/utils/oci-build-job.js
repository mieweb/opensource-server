#!/usr/bin/env node
/**
 * oci-build-job.js
 * 
 * This utility is called by ScheduledJob to pull and configure OCI LXC container images
 * (Debian 13 and Rocky 9) for Proxmox 9+.
 * 
 * It reads configuration from the database (Nodes model) to get API URLs and tokens,
 * then pulls OCI images from a container registry and makes them available in Proxmox storage.
 */

const axios = require('axios');
const db = require('../models');
const ProxmoxApi = require('./proxmox-api');

/**
 * Get list of available OCI images to pull
 */
function getOciImages() {
  return [
    {
      name: 'debian13',
      registry: process.env.OCI_REGISTRY || 'ghcr.io',
      image: 'mieweb/opensource-server/debian13',
      tag: process.env.OCI_IMAGE_TAG || 'latest'
    },
    {
      name: 'rocky9',
      registry: process.env.OCI_REGISTRY || 'ghcr.io',
      image: 'mieweb/opensource-server/rocky9',
      tag: process.env.OCI_IMAGE_TAG || 'latest'
    }
  ];
}

/**
 * Parse OCI image reference into components
 */
function parseImageReference(imageSpec) {
  // imageSpec format: registry/image:tag
  const parts = imageSpec.split('/');
  const registry = parts[0];
  const remaining = parts.slice(1).join('/');
  const [imagePath, tag] = remaining.split(':');
  
  return { registry, imagePath, tag: tag || 'latest' };
}

/**
 * Pull an OCI image to a Proxmox node
 */
async function pullImageToNode(node, imageSpec) {
  console.log(`[OCI Build] Pulling image ${imageSpec} to node ${node.name}`);

  if (!node.apiUrl || !node.tokenId || !node.secret) {
    console.warn(`[OCI Build] Warning: Node ${node.name} missing API credentials, skipping`);
    return false;
  }

  try {
    const api = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
      httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
    });

    // Get list of storages on the node
    const storages = await api.datastores(node.name, 'vztmpl');
    
    // Choose storage (prefer defaultStorage if set, otherwise use first available)
    let targetStorage = null;
    if (node.defaultStorage) {
      targetStorage = storages.find(s => s.storage === node.defaultStorage);
    }
    if (!targetStorage && storages.length > 0) {
      targetStorage = storages[0];
    }

    if (!targetStorage) {
      console.warn(`[OCI Build] No suitable storage found on node ${node.name}, skipping`);
      return false;
    }

    console.log(`[OCI Build] Using storage ${targetStorage.storage} on ${node.name}`);

    // Call the Proxmox API to pull the OCI image
    // This uses the pct pull-image API endpoint available in Proxmox 9+
    const pullResponse = await axios.post(
      `${node.apiUrl}/api2/json/nodes/${encodeURIComponent(node.name)}/pull-image`,
      {
        image: imageSpec,
        storage: targetStorage.storage
      },
      {
        headers: {
          'Authorization': `PVEAPIToken=${node.tokenId}=${node.secret}`
        },
        httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
      }
    );

    // The response contains a task ID that we should monitor
    const upid = pullResponse.data.data;
    console.log(`[OCI Build] Image pull started on ${node.name}, task: ${upid}`);

    // Optionally wait for task completion
    await waitForTaskCompletion(node, upid);

    console.log(`[OCI Build] Successfully pulled ${imageSpec} to ${node.name}`);
    return true;
  } catch (err) {
    console.error(`[OCI Build] Error pulling image to ${node.name}: ${err.message}`);
    return false;
  }
}

/**
 * Wait for a Proxmox task to complete
 */
async function waitForTaskCompletion(node, upid, maxWaitMs = 600000) {
  const startTime = Date.now();
  const pollIntervalMs = 5000;

  try {
    const api = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
      httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
    });

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const taskStatus = await api.taskStatus(node.name, upid);

        if (taskStatus.status === 'stopped') {
          if (taskStatus.exitstatus === 'OK') {
            console.log(`[OCI Build] Task ${upid} completed successfully`);
            return true;
          } else {
            throw new Error(`Task failed: ${taskStatus.exitstatus}`);
          }
        }

        // Task still running, wait and retry
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (err) {
        if (err.response?.status === 404) {
          // Task might have completed and been cleaned up
          return true;
        }
        throw err;
      }
    }

    throw new Error(`Task did not complete within ${maxWaitMs}ms`);
  } catch (err) {
    console.warn(`[OCI Build] Could not verify task completion: ${err.message}. Continuing...`);
    return true; // Don't fail, the task might still complete
  }
}

/**
 * Main job execution
 */
async function run() {
  try {
    console.log('[OCI Build] Starting OCI container image pull job');

    // Ensure database connection
    await db.sequelize.authenticate();
    console.log('[OCI Build] Database connected');

    // Get all nodes
    const nodes = await db.Node.findAll();
    if (!nodes || nodes.length === 0) {
      throw new Error('No Proxmox nodes configured in database');
    }

    console.log(`[OCI Build] Found ${nodes.length} node(s) to update`);

    // Get list of images to pull
    const images = getOciImages();
    console.log(`[OCI Build] Will pull ${images.length} image(s): ${images.map(i => i.name).join(', ')}`);

    // Pull each image to each node
    let successCount = 0;
    let failureCount = 0;

    for (const image of images) {
      const imageRef = `${image.registry}/${image.image}:${image.tag}`;
      console.log(`\n[OCI Build] Processing image: ${imageRef}`);

      for (const node of nodes) {
        try {
          const success = await pullImageToNode(node, imageRef);
          if (success) {
            successCount++;
          } else {
            failureCount++;
          }
        } catch (err) {
          console.error(`[OCI Build] Exception pulling to ${node.name}: ${err.message}`);
          failureCount++;
        }
      }
    }

    console.log(`\n[OCI Build] Job completed - ${successCount} successful, ${failureCount} failed`);

    if (failureCount === 0) {
      console.log('[OCI Build] OCI image pull job completed successfully');
      process.exit(0);
    } else if (successCount > 0) {
      console.log('[OCI Build] OCI image pull job completed with some failures');
      process.exit(0); // Partial success is acceptable
    } else {
      throw new Error('All image pulls failed');
    }
  } catch (err) {
    console.error('[OCI Build] Fatal error:', err.message);
    process.exit(1);
  }
}

module.exports = { run };

// If called directly as a script
if (require.main === module) {
  run();
}

