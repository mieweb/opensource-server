#!/usr/bin/env node
/**
 * oci-build-push-pull.js
 * 
 * Combined OCI image build, push, and pull job.
 * 
 * This utility:
 * 1. Builds site-specific OCI images using Docker with --build-arg DOMAIN
 * 2. Pushes site images to a local registry
 * 3. Pulls pre-built OCI images (Debian 13, Rocky 9) to all Proxmox nodes
 * 4. Pulls site-specific images to all Proxmox nodes
 * 
 * Environment variables:
 * - LOCAL_REGISTRY (default: localhost:5000)
 * - OCI_REPO (default: opensource-server)
 * - BUILD_CONTEXT (default: /opt/opensource-server)
 * - DOCKERFILE_PATH (default: /opt/opensource-server/templates/debian.Dockerfile)
 * - IMAGE_TAG_SUFFIX (default: latest)
 * - OCI_IMAGE_TAG (default: latest, for pre-built images)
 */

const { spawn } = require('child_process');
const db = require('../models');
const { pullImageToNode } = require('./proxmox-utils');

/**
 * Sanitize domain/site name into valid Docker tag
 */
function sanitizeTag(s) {
  return (s || 'site').toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 128);
}

/**
 * Execute a command and stream output, return promise
 */
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

/**
 * Get list of pre-built OCI images to pull
 */
function getPreBuiltImages() {
  return [
    {
      name: 'debian13',
      registry: process.env.LOCAL_REGISTRY || process.env.OCI_REGISTRY || 'localhost:5000',
      image: 'mieweb/opensource-server/debian13',
      tag: process.env.OCI_IMAGE_TAG || 'latest'
    },
    {
      name: 'rocky9',
      registry: process.env.LOCAL_REGISTRY || process.env.OCI_REGISTRY || 'localhost:5000',
      image: 'mieweb/opensource-server/rocky9',
      tag: process.env.OCI_IMAGE_TAG || 'latest'
    }
  ];
}

/**
 * Build and push a site-specific OCI image
 */
async function buildAndPushImageForSite(site, registry, repoBase, buildContext, dockerfilePath, tagSuffix = 'latest') {
  const domain = site.internalDomain || site.domain || site.name || `site-${site.id}`;
  const sanitized = sanitizeTag(domain);
  const imageRef = `${registry}/${repoBase}/${sanitized}:${tagSuffix}`;

  console.log(`[oci-build-push-pull] Building image for site ${site.id} (${domain}) -> ${imageRef}`);

  // docker build --build-arg DOMAIN=${domain} -f <dockerfile> -t <imageRef> <context>
  await runCommandStreamed('docker', [
    'build',
    '--build-arg', `DOMAIN=${domain}`,
    '-f', dockerfilePath,
    '-t', imageRef,
    buildContext
  ]);

  console.log(`[oci-build-push-pull] Pushing image ${imageRef} to registry ${registry}`);
  await runCommandStreamed('docker', ['push', imageRef]);

  return { imageRef, domain };
}

/**
 * Main job execution: build/push site images and pull all images to nodes
 */
async function run() {
  const registry = process.env.LOCAL_REGISTRY || 'localhost:5000';
  const repoBase = process.env.OCI_REPO || 'opensource-server';
  const buildContext = process.env.BUILD_CONTEXT || '/opt/opensource-server';
  const dockerfilePath = process.env.DOCKERFILE_PATH || '/opt/opensource-server/templates/debian.Dockerfile';
  const tagSuffix = process.env.IMAGE_TAG_SUFFIX || 'latest';

  try {
    await db.sequelize.authenticate();
    console.log('[oci-build-push-pull] Database connected');

    // ========== PHASE 1: Build and push site-specific images ==========
    console.log('\n[oci-build-push-pull] ========== PHASE 1: Build & Push Site Images ==========');
    
    const sites = await db.Site.findAll();
    const siteImages = [];

    if (!sites || sites.length === 0) {
      console.warn('[oci-build-push-pull] No sites found in DB; skipping site image builds');
    } else {
      console.log(`[oci-build-push-pull] Found ${sites.length} site(s) to build`);

      for (const site of sites) {
        try {
          const { imageRef } = await buildAndPushImageForSite(site, registry, repoBase, buildContext, dockerfilePath, tagSuffix);
          siteImages.push(imageRef);
        } catch (err) {
          console.error(`[oci-build-push-pull] Error building/pushing for site ${site.id}: ${err.message}`);
        }
      }

      console.log(`[oci-build-push-pull] Successfully built and pushed ${siteImages.length}/${sites.length} site images`);
    }

    // ========== PHASE 2: Prepare all images to pull ==========
    console.log('\n[oci-build-push-pull] ========== PHASE 2: Prepare Images to Pull ==========');

    const preBuiltImages = getPreBuiltImages();
    const allImagesToPull = [...siteImages, ...preBuiltImages.map(img => `${img.registry}/${img.image}:${img.tag}`)];

    console.log(`[oci-build-push-pull] Will pull ${allImagesToPull.length} total image(s):`);
    allImagesToPull.forEach(img => console.log(`  - ${img}`));

    // ========== PHASE 3: Pull all images to all nodes ==========
    console.log('\n[oci-build-push-pull] ========== PHASE 3: Pull Images to Nodes ==========');

    const nodes = await db.Node.findAll();
    if (!nodes || nodes.length === 0) {
      console.warn('[oci-build-push-pull] No Proxmox nodes found in DB; skipping pull operations');
      console.log('[oci-build-push-pull] Job completed successfully');
      process.exit(0);
    }

    console.log(`[oci-build-push-pull] Found ${nodes.length} Proxmox node(s)`);

    let totalSuccess = 0;
    let totalFailure = 0;

    for (const imageRef of allImagesToPull) {
      console.log(`\n[oci-build-push-pull] Pulling image: ${imageRef}`);

      const pulls = nodes.map(node => pullImageToNode(node, imageRef, '[oci-build-push-pull]'));
      const results = await Promise.allSettled(pulls);
      
      const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
      const failed = results.length - success;
      
      totalSuccess += success;
      totalFailure += failed;

      console.log(`[oci-build-push-pull] Image ${imageRef} pulled to ${success}/${nodes.length} nodes (${failed} failures)`);
    }

    // ========== Final Summary ==========
    console.log('\n[oci-build-push-pull] ========== Job Summary ==========');
    console.log(`[oci-build-push-pull] Site images built: ${siteImages.length}`);
    console.log(`[oci-build-push-pull] Pre-built images pulled: ${preBuiltImages.length}`);
    console.log(`[oci-build-push-pull] Total pull operations: ${totalSuccess + totalFailure}`);
    console.log(`[oci-build-push-pull] Successful pulls: ${totalSuccess}`);
    console.log(`[oci-build-push-pull] Failed pulls: ${totalFailure}`);

    if (totalFailure === 0 || totalSuccess > 0) {
      console.log('[oci-build-push-pull] OCI build, push, and pull job completed successfully');
      process.exit(0);
    } else {
      throw new Error('All pull operations failed');
    }
  } catch (err) {
    console.error('[oci-build-push-pull] Fatal error:', err.message);
    process.exit(1);
  }
}

module.exports = { run };

// If called directly as a script
if (require.main === module) {
  run();
}
