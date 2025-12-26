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
const ProxmoxApi = require('../utils/proxmox-api');

/**
 * Sanitize domain/site name into valid Docker tag.
 * Converts to lowercase, replaces invalid characters with hyphens, and limits length.
 * @param {string} s - Input domain or site name
 * @returns {string} Sanitized tag suitable for Docker image naming
 */
function sanitizeTag(s) {
  return (s || 'site').toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 128);
}

/**
 * Execute a command and stream output to console, returning a promise.
 * @param {string} cmd - Command to execute (e.g., 'docker')
 * @param {string[]} args - Command arguments
 * @param {object} [opts={}] - Additional options for spawn (e.g., cwd, env)
 * @returns {Promise<void>} Resolves on success, rejects if command exits with non-zero code
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
 * Build and push a site-specific OCI image using Docker.
 * @param {object} site - Site database object with id, name, domain, internalDomain properties
 * @param {string} registry - Container registry URL (e.g., localhost:5000)
 * @param {string} repoBase - Repository base path in registry (e.g., opensource-server)
 * @param {string} buildContext - Docker build context path
 * @param {string} dockerfilePath - Path to Dockerfile to use for build
 * @param {string} [tagSuffix='latest'] - Image tag suffix (appended after domain)
 * @returns {Promise<{imageRef: string, domain: string}>} Built image reference and domain used
 * @throws {Error} If docker build or push fails
 */
async function buildAndPushImageForSite(site, registry, repoBase, buildContext, dockerfilePath, tagSuffix = 'latest') {
  const domain = site.internalDomain;
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
 * Main job execution: orchestrate three phases of OCI image management.
 * Phase 1: Build site-specific images from Dockerfile and push to registry.
 * Phase 2: Prepare list of all images (site + pre-built) to pull.
 * Phase 3: Pull all images to all Proxmox nodes concurrently.
 *
 * Configuration may be supplied via CLI args (preferred) or environment variables as fallbacks.
 * @param {object} [opts]
 * @param {string} [opts.registry] - Container registry (overrides LOCAL_REGISTRY env)
 * @param {string} [opts.repoBase] - Repository base path in registry (overrides OCI_REPO env)
 * @param {string} [opts.buildContext] - Docker build context path (overrides BUILD_CONTEXT env)
 * @param {string} [opts.dockerfilePath] - Path to Dockerfile (overrides DOCKERFILE_PATH env)
 * @param {string} [opts.tagSuffix] - Image tag suffix (overrides IMAGE_TAG_SUFFIX env)
 * @returns {Promise<void>} Resolves on completion, calls process.exit(0) or process.exit(1)
 */
async function run(opts = {}) {
  const registry = opts.registry || process.env.LOCAL_REGISTRY || 'localhost:5000';
  const repoBase = opts.repoBase || process.env.OCI_REPO || 'opensource-server';
  const buildContext = opts.buildContext || process.env.BUILD_CONTEXT || '/opt/opensource-server';
  const dockerfilePath = opts.dockerfilePath || process.env.DOCKERFILE_PATH || '/opt/opensource-server/templates/debian.Dockerfile';
  const tagSuffix = opts.tagSuffix || process.env.IMAGE_TAG_SUFFIX || 'latest';

  try {
    await db.sequelize.authenticate();
    console.log('[oci-build-push-pull] Database connected');
    
    // ========== PHASE 1: Build and push site-specific images ==========
    console.log('[oci-build-push-pull] ========== PHASE 1: Build & Push Site Images ==========');
    
    const sites = await db.Site.findAll();
    const siteImages = [];

    if (!sites || sites.length === 0) {
      console.warn('[oci-build-push-pull] No sites found in DB; skipping site image builds');
    } else {
      console.log(`[oci-build-push-pull] Found ${sites.length} site(s) to build`);

      // Run all site builds in parallel and collect results
      const buildPromises = sites.map(site => buildAndPushImageForSite(site, registry, repoBase, buildContext, dockerfilePath, tagSuffix));
      const buildResults = await Promise.allSettled(buildPromises);

      buildResults.forEach((res, idx) => {
        const site = sites[idx];
        if (res.status === 'fulfilled') {
          siteImages.push(res.value.imageRef);
        } else {
          console.error(`[oci-build-push-pull] Error building/pushing for site ${site.id}: ${res.reason && res.reason.message ? res.reason.message : res.reason}`);
        }
      });

      console.log(`[oci-build-push-pull] Successfully built and pushed ${siteImages.length}/${sites.length} site images`);
    }

    // ========== PHASE 2: Prepare all images to pull ==========
    // We only pull site-built images; pre-built templates are not handled here.
    const allImagesToPull = [...siteImages];
    console.log(`[oci-build-push-pull] Will pull ${allImagesToPull.length} site image(s):`);
    allImagesToPull.forEach(img => console.log(`  - ${img}`));

    // ========== PHASE 3: Pull all images to all nodes ==========
    console.log('[oci-build-push-pull] ========== PHASE 3: Pull Images to Nodes ==========');

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
      console.log(`[oci-build-push-pull] Pulling image: ${imageRef}`);

      const pulls = nodes.map(async (node) => {
        if (!node.apiUrl || !node.tokenId || !node.secret) {
          console.warn(`[oci-build-push-pull] Node ${node.name} missing API credentials, skipping pull`);
          return false;
        }

        try {
          const api = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
            httpsAgent: { rejectUnauthorized: node.tlsVerify !== false }
          });

          const targetStorage = await api.chooseStorageForVztmpl(node.name, node.defaultStorage);
          if (!targetStorage) {
            console.warn(`[oci-build-push-pull] No suitable storage on node ${node.name}, skipping`);
            return false;
          }

          console.log(`[oci-build-push-pull] Instructing node ${node.name} to pull ${imageRef} into storage ${targetStorage}`);
          await api.pullImageAndWait(node.name, imageRef, targetStorage);
          return true;
        } catch (err) {
          console.error(`[oci-build-push-pull] Failed to pull ${imageRef} on ${node.name}: ${err.message}`);
          return false;
        }
      });

      const results = await Promise.allSettled(pulls);
      const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
      const failed = results.length - success;

      totalSuccess += success;
      totalFailure += failed;

      console.log(`[oci-build-push-pull] Image ${imageRef} pulled to ${success}/${nodes.length} nodes (${failed} failures)`);
    }

    // ========== Final Summary ==========
    console.log('[oci-build-push-pull] ========== Job Summary ==========');
    console.log(`[oci-build-push-pull] Site images built: ${siteImages.length}`);
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

// Simple CLI arg parser supporting `--key=value` and `--key value` forms
function parseCliArgs() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      const key = a.slice(2, eq);
      const val = a.slice(eq + 1);
      out[key] = val;
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

// Execute the job when this file is loaded by the scheduler, using CLI args if provided
const parsedOptions = parseCliArgs();
run(parsedOptions);
