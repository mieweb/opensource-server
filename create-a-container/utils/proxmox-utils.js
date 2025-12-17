/**
 * proxmox-utils.js
 * 
 * Shared utilities for Proxmox API interactions:
 * - Task polling (wait for task completion)
 * - OCI image pulling to nodes
 */

const ProxmoxApi = require('./proxmox-api');

/**
 * Poll a Proxmox task until completion or timeout
 * 
 * @param {Object} node - Node object with apiUrl, tokenId, secret, tlsVerify
 * @param {string} upid - Unique task ID returned from Proxmox API
 * @param {string} [logPrefix='[proxmox-utils]'] - Prefix for log messages
 * @returns {Promise<boolean>} - True if task succeeded
 * @throws {Error} - If task failed or timed out
 */
async function pollTaskUntilComplete(node, upid, logPrefix = '[proxmox-utils]') {
  const api = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
    httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
  });

  const pollIntervalMs = parseInt(process.env.PULL_POLL_MS || '5000', 10);
  const maxWaitMs = parseInt(process.env.PULL_MAX_WAIT_MS || '600000', 10);
  const start = Date.now();
  let statusObj = null;

  while (Date.now() - start < maxWaitMs) {
    statusObj = await api.taskStatus(node.name, upid);
    if (statusObj && statusObj.status === 'stopped') break;
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  if (!statusObj) {
    throw new Error(`Could not retrieve status for task ${upid}`);
  }

  if (statusObj.exitstatus && statusObj.exitstatus !== 'OK') {
    throw new Error(`Task ${upid} failed with exitstatus=${statusObj.exitstatus}`);
  }

  return true;
}

/**
 * Trigger pull of an OCI image on a Proxmox node and wait for completion
 * 
 * @param {Object} node - Node object with apiUrl, tokenId, secret, tlsVerify, name, defaultStorage
 * @param {string} imageRef - Full image reference (e.g., localhost:5000/repo/image:tag)
 * @param {string} [logPrefix='[proxmox-utils]'] - Prefix for log messages
 * @returns {Promise<boolean>} - True if pull succeeded, false if skipped
 */
async function pullImageToNode(node, imageRef, logPrefix = '[proxmox-utils]') {
  if (!node.apiUrl || !node.tokenId || !node.secret) {
    console.warn(`${logPrefix} Node ${node.name} missing API credentials, skipping pull`);
    return false;
  }

  try {
    const api = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
      httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
    });

    // Get available storage for templates
    const storages = await api.datastores(node.name, 'vztmpl');
    
    // Prefer defaultStorage if set, otherwise use first available
    let targetStorage = null;
    if (node.defaultStorage) {
      targetStorage = storages.find(s => s.storage === node.defaultStorage);
    }
    if (!targetStorage && storages.length > 0) {
      targetStorage = storages[0];
    }
    if (!targetStorage) {
      console.warn(`${logPrefix} No suitable storage on node ${node.name}, skipping`);
      return false;
    }

    console.log(`${logPrefix} Instructing node ${node.name} to pull ${imageRef} into storage ${targetStorage.storage}`);

    // Request the node pull the image
    const upid = await api.pullImage(node.name, imageRef, targetStorage.storage);
    console.log(`${logPrefix} Pull started on ${node.name}, upid: ${upid}`);

    // Wait for task completion
    await pollTaskUntilComplete(node, upid, logPrefix);
    console.log(`${logPrefix} Successfully pulled ${imageRef} to ${node.name}`);
    return true;
  } catch (err) {
    console.error(`${logPrefix} Failed to pull on ${node.name}: ${err.message}`);
    return false;
  }
}

module.exports = {
  pollTaskUntilComplete,
  pullImageToNode
};
