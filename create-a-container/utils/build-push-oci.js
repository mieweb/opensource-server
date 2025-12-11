#!/usr/bin/env node
/**
 * build-push-oci.js
 *
 * Build site-specific OCI images using Docker build --build-arg DOMAIN=... and push them
 * to a local registry, then trigger each Proxmox hypervisor to pull the built image.
 *
 * Behavior:
 * - For each Site in the DB:
 *   - domain = site.internalDomain (fallback to site.domain or site.name)
 *   - image tag is generated from domain (sanitized) and 'latest' (configurable)
 *   - docker build --build-arg DOMAIN=${domain} -f /opt/opensource-server/templates/debian.Dockerfile -t ${imageRef} /opt/opensource-server
 *   - docker push ${imageRef}
 * - For each Node in the DB:
 *   - call Proxmox pull-image API to pull ${imageRef} into node's defaultStorage
 *
 * Config (env):
 * - LOCAL_REGISTRY (default: localhost:5000)
 * - OCI_REPO (default: opensource-server)
 * - BUILD_CONTEXT (default: /opt/opensource-server)
 * - DOCKERFILE_PATH (default: /opt/opensource-server/templates/debian.Dockerfile)
 */

const { spawn } = require('child_process');
const db = require('../models');
const axios = require('axios');
const ociJob = require('./oci-build-job'); // reuse waitForTaskCompletion
const ProxmoxApi = require('./proxmox-api');

function sanitizeTag(s) {
  return (s || 'site').toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 128);
}

function runCommandStreamed(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function buildAndPushImageForSite(site, registry, repoBase, buildContext, dockerfilePath, tagSuffix = 'latest') {
  const domain = site.internalDomain || site.domain || site.name || `site-${site.id}`;
  const sanitized = sanitizeTag(domain);
  const tag = `${sanitized}-${tagSuffix}`;
  const imageRef = `${registry}/${repoBase}/${sanitized}:${tagSuffix}`;

  console.log(`[build-push-oci] Building image for site ${site.id} (${domain}) -> ${imageRef}`);

  // docker build --build-arg DOMAIN=${domain} -f <dockerfile> -t <imageRef> <context>
  const buildArgs = [
    'build',
    '--build-arg', `DOMAIN=${domain}`,
    '-f', dockerfilePath,
    '-t', imageRef,
    buildContext
  ];

  await runCommandStreamed('docker', buildArgs);

  console.log(`[build-push-oci] Pushing image ${imageRef} to registry ${registry}`);
  await runCommandStreamed('docker', ['push', imageRef]);

  return { imageRef, domain, tag };
}

async function triggerPullOnNode(node, imageRef) {
  if (!node.apiUrl || !node.tokenId || !node.secret) {
    console.warn(`[build-push-oci] Node ${node.name} missing API credentials, skipping pull`);
    return false;
  }

  try {
    const api = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
      httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
    });

    const storages = await api.datastores(node.name, 'vztmpl');
    let targetStorage = null;
    if (node.defaultStorage) {
      targetStorage = storages.find(s => s.storage === node.defaultStorage);
    }
    if (!targetStorage && storages.length > 0) {
      targetStorage = storages[0];
    }
    if (!targetStorage) {
      console.warn(`[build-push-oci] No suitable storage on node ${node.name}, skipping`);
      return false;
    }

    console.log(`[build-push-oci] Instructing node ${node.name} to pull ${imageRef} into storage ${targetStorage.storage}`);

    const resp = await axios.post(
      `${node.apiUrl}/api2/json/nodes/${encodeURIComponent(node.name)}/pull-image`,
      { image: imageRef, storage: targetStorage.storage },
      {
        headers: { 'Authorization': `PVEAPIToken=${node.tokenId}=${node.secret}` },
        httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
      }
    );

    const upid = resp.data?.data;
    console.log(`[build-push-oci] Pull started on ${node.name}, upid: ${upid}`);

    // reuse waitForTaskCompletion from oci-build-job
    await ociJob.waitForTaskCompletion(node, upid);
    return true;
  } catch (err) {
    console.error(`[build-push-oci] Failed to trigger pull on ${node.name}: ${err.message}`);
    return false;
  }
}

async function run() {
  const registry = process.env.LOCAL_REGISTRY || 'localhost:5000';
  const repoBase = process.env.OCI_REPO || 'opensource-server';
  const buildContext = process.env.BUILD_CONTEXT || '/opt/opensource-server';
  const dockerfilePath = process.env.DOCKERFILE_PATH || '/opt/opensource-server/templates/debian.Dockerfile';
  const tagSuffix = process.env.IMAGE_TAG_SUFFIX || 'latest';

  try {
    await db.sequelize.authenticate();
    console.log('[build-push-oci] DB connected');

    const sites = await db.Site.findAll();
    if (!sites || sites.length === 0) {
      console.warn('[build-push-oci] No sites found in DB; nothing to build');
      return process.exit(0);
    }

    const nodes = await db.Node.findAll();
    if (!nodes || nodes.length === 0) {
      console.warn('[build-push-oci] No nodes found in DB; will only push to registry');
    }

    for (const site of sites) {
      try {
        const { imageRef } = await buildAndPushImageForSite(site, registry, repoBase, buildContext, dockerfilePath, tagSuffix);

        // Trigger pull on each node in parallel but await all
        if (nodes && nodes.length) {
          const pulls = nodes.map(node => triggerPullOnNode(node, imageRef));
          const results = await Promise.allSettled(pulls);
          const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
          const failed = results.length - success;
          console.log(`[build-push-oci] Image ${imageRef} pulled on ${success} nodes, ${failed} failures`);
        } else {
          console.log(`[build-push-oci] Image ${imageRef} pushed to registry only (no nodes configured)`);
        }
      } catch (err) {
        console.error(`[build-push-oci] Error building/pushing for site ${site.id}: ${err.message}`);
      }
    }

    console.log('[build-push-oci] All sites processed');
    process.exit(0);
  } catch (err) {
    console.error('[build-push-oci] Fatal error:', err.message);
    process.exit(1);
  }
}

module.exports = { run };

// If called directly
if (require.main === module) {
  run();
}
