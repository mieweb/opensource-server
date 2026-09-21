#!/usr/bin/env node
/**
 * create-container.js
 * 
 * Background job script that performs the actual Proxmox container creation.
 * This script is executed by the job-runner after a pending container record
 * has been created in the database.
 * 
 * Usage: node bin/create-container.js --container-id=<id>
 * 
 * The script will:
 * 1. Load the container record from the database
 * 2. Either clone a Proxmox template OR pull a Docker image and create from it
 * 3. Configure the container (cores, memory, network)
 * 4. Start the container
 * 5. Query MAC address from Proxmox config
 * 6. Query IP address from Proxmox interfaces API
 * 7. Update the container record with MAC, IP, and status='running'
 * 
 * Docker images are detected by the presence of '/' in the template field.
 * Format: host/org/image:tag (e.g., docker.io/library/nginx:latest)
 * 
 * All output is logged to STDOUT for capture by the job-runner.
 * Exit code 0 = success, non-zero = failure.
 */

const path = require('path');

// Load models from parent directory
const db = require(path.join(__dirname, '..', 'models'));
const { Container, Node, Site, Service, HTTPService, ExternalDomain, Setting, ResourceRequest, Volume } = db;

// Load utilities
const { parseArgs } = require(path.join(__dirname, '..', 'utils', 'cli'));
const { isDockerImage, parseDockerRef, getImageDigest } = require(path.join(__dirname, '..', 'utils', 'docker-registry'));
const { manageDnsRecords } = require(path.join(__dirname, '..', 'utils', 'cloudflare-dns'));
const { createVirtualMachine, withNetbox } = require(path.join(__dirname, '..', 'utils', 'netbox'));
const {
  resolveVolumesRoot,
  quickAndDirtyVolumeSpec,
  deriveVolumeHostPaths,
} = require(path.join(__dirname, '..', 'utils', 'volumes'));

/**
 * Generate a filename for a pulled Docker image
 * Replaces special chars with underscores, includes digest for cache busting
 * Note: Proxmox automatically appends .tar, so we don't include it here
 * @param {object} parsed - Parsed Docker ref components
 * @param {string} digest - Short digest hash
 * @returns {string} Sanitized filename (e.g., "docker.io_library_nginx_latest_abc123def456")
 */
function generateImageFilename(parsed, digest) {
  const { registry, namespace, image, tag } = parsed;
  const sanitized = `${registry}_${namespace}_${image}_${tag}_${digest}`.replace(/[/:]/g, '_');
  return sanitized;
}

/**
 * Parse the disk size in gigabytes from a Proxmox LXC `rootfs` config value.
 * Example input: "local-lvm:vm-123-disk-0,size=50G" → 50
 * Supports T/G/M/K suffixes; defaults to gigabytes when no suffix is present.
 * @param {string} [rootfs] - The rootfs config string from lxcConfig
 * @returns {number|null} Disk size rounded to whole gigabytes, or null if unparseable
 */
function parseRootfsSizeGb(rootfs) {
  if (!rootfs) return null;
  const match = /size=(\d+(?:\.\d+)?)([TGMK])?/i.exec(rootfs);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'G').toUpperCase();
  const gb = { T: value * 1024, G: value, M: value / 1024, K: value / (1024 * 1024) }[unit];
  return Number.isFinite(gb) ? Math.round(gb) : null;
}

/**
 * Resolve which Proxmox storage to use for a given content type.
 * Returns the preferred storage if it supports the content type,
 * otherwise falls back to the largest enabled storage that does.
 * @param {object} client - ProxmoxApi instance
 * @param {string} nodeName - Proxmox node name
 * @param {string} preferred - Preferred storage name
 * @param {string} contentType - Proxmox content type ('vztmpl' or 'rootdir')
 * @returns {Promise<string>} Resolved storage name
 * @throws {Error} If no enabled storage supports the content type
 */
async function resolveStorage(client, nodeName, preferred, contentType) {
  const storages = await client.datastores(nodeName, contentType, true);
  if (storages.length === 0) {
    throw new Error(`No enabled storage on node ${nodeName} supports content type '${contentType}'`);
  }
  if (storages.some(s => s.storage === preferred)) {
    return preferred;
  }
  const largest = storages.reduce((max, s) => (s.total > max.total ? s : max), storages[0]);
  console.warn(`Storage '${preferred}' does not support '${contentType}' on node ${nodeName}, falling back to '${largest.storage}'`);
  return largest.storage;
}

/**
 * Ensure this container's Volume rows exist with derived host paths, then wait
 * until every volume's host directory has been provisioned by the site agent
 * before any bind mount is set on the container. Implements issue #421.
 *
 * The flow:
 *  1. Resolve the volumes root from the node storage's ACTUAL configured path.
 *  2. Seed the built-in `quick_and_dirty` read-only volume if the container has
 *     no volumes yet (preserves the retired mp0 behavior by construction).
 *  3. Backfill host paths on any volume rows that are missing one.
 *  4. Built-in volumes are marked `ready` immediately (admin-provisioned dir);
 *     user volumes are left `pending` so the next check-in snapshot advertises
 *     them to the agent, which mkdir()s the directory and reports the result.
 *  5. Block on `Volume.status = 'ready'` for every volume (bounded timeout).
 *
 * @param {object} client - NodeApi client
 * @param {object} node - Node model instance
 * @param {object} container - Container model instance
 * @returns {Promise<Volume[]>} The container's ready volumes, ordered by id
 */
/**
 * Prepare this container's volumes and BLOCK until every host directory has
 * been provisioned by the site agent — run this BEFORE the container is created
 * on the provider, so a barrier failure never leaves an orphaned, half-created
 * CT (issue #421). No provider handle is needed: the agent creates directories
 * from the Volume rows (persisted before the CT exists), and this only reads the
 * derived host paths and the `Volume.status` column.
 *
 * The flow:
 *  1. Resolve the volumes root from the node storage's ACTUAL configured path.
 *  2. Seed the built-in `quick_and_dirty` read-only volume if the container has
 *     no volumes yet (preserves the retired mp0 behavior by construction).
 *  3. Derive + persist any missing host paths; mark built-in / docker volumes
 *     `ready` immediately (they don't need the agent). User volumes stay
 *     `pending` so the next check-in snapshot advertises them to the agent.
 *  4. Block on `Volume.status = 'ready'` for every volume (bounded timeout).
 *
 * @param {object} client - NodeApi client
 * @param {object} node - Node model instance
 * @param {object} container - Container model instance
 * @returns {Promise<Volume[]>} The container's ready volumes, ordered by id
 */
async function prepareVolumes(client, node, container) {
  const { root: volumesRoot, shared } = await resolveVolumesRoot(client, node);
  console.log(`Volumes root: ${volumesRoot} (shared=${shared})`);
  if (!shared && node.nodeType !== 'docker') {
    console.warn(
      '⚠️  WARNING: volumes storage is not shared across nodes; persistent volume ' +
        'data will not follow this container if it is migrated to another node. ' +
        'See https://github.com/mieweb/opensource-server/issues/421',
    );
  }

  let volumes = await Volume.findAll({ where: { containerId: container.id } });

  // Seed the built-in shared read-only volume when the container defines none,
  // so today's shared /mnt/quick_and_dirty mount is preserved by construction.
  if (volumes.length === 0) {
    const spec = quickAndDirtyVolumeSpec(volumesRoot);
    const builtin = await Volume.create({
      containerId: container.id,
      name: spec.name,
      hostPath: spec.hostPath,
      mountPath: spec.mountPath,
      mode: spec.mode,
      scope: 'container',
      builtin: true,
      // The built-in shared dir is admin-provisioned; treat it as ready so it
      // never blocks and matches the pre-#421 behavior.
      status: 'ready',
      appliedAt: new Date(),
    });
    volumes = [builtin];
  }

  // Derive + persist missing host paths; mark builtin/docker volumes ready.
  await deriveVolumeHostPaths(volumes, {
    volumesRoot,
    hostname: container.hostname,
    nodeType: node.nodeType,
  });

  // Sync barrier: the agent creates directories asynchronously (~30 s timer),
  // and Proxmox 400s if mpN points at a missing dir. Block on Volume.status.
  await waitForVolumesReady(container.id);

  return Volume.findAll({ where: { containerId: container.id }, order: [['id', 'ASC']] });
}

/**
 * Poll `Volume.status` until every volume for a container is `ready`, or throw
 * when any is `failed` (surfacing its statusMessage) or the timeout elapses.
 * The agent transitions these via the extended check-in; this only watches the
 * DB column.
 *
 * The default timeout accommodates the agent's ~30 s timer plus the two
 * check-ins needed per volume (receive snapshot, then report results). Override
 * via VOLUME_READY_TIMEOUT_MS for slow or contended clusters.
 *
 * @param {number} containerDbId
 * @param {number} [timeoutMs] Bounded wait (default 5 minutes; env override)
 * @param {number} [pollMs] Poll interval (default 5 s)
 */
async function waitForVolumesReady(
  containerDbId,
  timeoutMs = parseInt(process.env.VOLUME_READY_TIMEOUT_MS, 10) || 300000,
  pollMs = 5000,
) {
  const start = Date.now();
  for (;;) {
    const volumes = await Volume.findAll({ where: { containerId: containerDbId } });
    const failed = volumes.find((v) => v.status === 'failed');
    if (failed) {
      throw new Error(
        `Volume '${failed.name}' provisioning failed on the node: ${failed.statusMessage || 'unknown error'}`,
      );
    }
    const pending = volumes.filter((v) => v.status !== 'ready');
    if (pending.length === 0) {
      console.log('All volume directories are ready');
      return;
    }
    if (Date.now() - start > timeoutMs) {
      const names = pending.map((v) => `${v.name} (${v.status})`).join(', ');
      throw new Error(
        `Timed out waiting for volume provisioning on the node after ${Math.round(timeoutMs / 1000)}s: ${names}`,
      );
    }
    console.log(
      `Waiting for volume provisioning on node (${pending.length} pending: ${pending
        .map((v) => v.name)
        .join(', ')})...`,
    );
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Setup ACL for container owner
 * Grants PVEVMUser role to username@ldap on /vms/{vmid}
 * Non-blocking: logs errors but continues on failure
 * @param {ProxmoxApi} client - Proxmox API client
 * @param {string} nodeName - Node name for logging
 * @param {number} vmid - Container VMID
 * @param {string} username - Container owner username
 * @returns {Promise<boolean>} True if ACL created successfully, false otherwise
 */
async function setupContainerAcl(client, nodeName, vmid, username) {
  const userWithRealm = `${username}@ldap`;
  const aclPath = `/vms/${vmid}`;
  
  console.log(`Setting up ACL for ${userWithRealm} on ${aclPath}...`);
  
  try {
    // Attempt to create ACL
    await client.updateAcl(aclPath, 'PVEVMUser', null, true, null, userWithRealm);
    console.log(`ACL created successfully: ${userWithRealm} -> PVEVMUser on ${aclPath}`);
    return true;
  } catch (firstError) {
    console.log(`ACL creation failed: ${firstError.message}`);
    
    // Check if error is due to user not existing
    const errorMsg = firstError.response?.data?.errors || firstError.message || '';
    const isUserNotFound = errorMsg.toLowerCase().includes('user') && 
                          (errorMsg.toLowerCase().includes('not found') || 
                           errorMsg.toLowerCase().includes('does not exist'));
    
    if (isUserNotFound) {
      console.log('User not found in Proxmox LDAP realm, attempting LDAP sync...');
      
      try {
        // Sync LDAP realm
        await client.syncLdapRealm('ldap');
        console.log('LDAP realm sync completed successfully');
        
        // Retry ACL creation
        console.log('Retrying ACL creation...');
        await client.updateAcl(aclPath, 'PVEVMUser', null, true, null, userWithRealm);
        console.log(`ACL created successfully after sync: ${userWithRealm} -> PVEVMUser on ${aclPath}`);
        return true;
      } catch (syncError) {
        console.log(`LDAP sync or retry failed: ${syncError.message}`);
        console.log('Continuing without ACL - container owner will need manual access grant');
        return false;
      }
    } else {
      console.log('ACL creation failed for non-user-related reason');
      console.log('Continuing without ACL - container owner will need manual access grant');
      return false;
    }
  }
}

function parseDockerTaskId(taskId, expectedKind = null) {
  if (typeof taskId !== 'string') return null;

  const parts = taskId.split(':');
  if (parts[0] !== 'docker' || parts.length < 3) return null;
  if (expectedKind && parts[1] !== expectedKind) return null;

  return parts.slice(2).join(':');
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();
  
  if (!args['container-id']) {
    console.error('Usage: node create-container.js --container-id=<id>');
    process.exit(1);
  }
  
  const containerId = parseInt(args['container-id'], 10);
  console.log(`Starting container creation for container ID: ${containerId}`);
  
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

  // Guard against double-provisioning. Once a provider container ID has been
  // allocated and stored, creation has already run for this container.
  if (container.containerId) {
    console.error(
      `Container already has a provider container ID (${container.containerId}); refusing to re-create`,
    );
    process.exit(1);
  }
  
  const node = container.node;
  const site = node.site;
  
  if (!node) {
    console.error('Container has no associated node');
    process.exit(1);
  }
  
  if (!site) {
    console.error('Node has no associated site');
    process.exit(1);
  }
  
  console.log(`Container: ${container.hostname}`);
  console.log(`Node: ${node.name}`);
  console.log(`Site: ${site.name} (${site.internalDomain})`);
  console.log(`Template: ${container.template}`);

  // Look up approved resource requests for this container identity
  const approvedResources = await ResourceRequest.getApprovedResources(
    site.id,
    container.hostname,
    container.username,
  );
  const { RESOURCE_DEFAULTS } = ResourceRequest;
  const cores = approvedResources.cpus || RESOURCE_DEFAULTS.cpus;
  const memory = approvedResources.memory || RESOURCE_DEFAULTS.memory;
  const swap = approvedResources.swap || RESOURCE_DEFAULTS.swap;
  const rootfsSize = approvedResources.rootfs || RESOURCE_DEFAULTS.rootfs;
  console.log(`Resources: cores=${cores}, memory=${memory}MB, swap=${swap}MB, rootfs=${rootfsSize}GB`);

  const isDocker = isDockerImage(container.template);
  const isDockerNode = node.nodeType === 'docker';
  console.log(`Template type: ${isDocker ? 'Docker image' : 'Proxmox template'}`);
  
  try {
    // Get the Proxmox API client
    const client = await node.api();
    console.log('Node API client initialized');

    // Prepare volumes and BLOCK on the site agent creating their host
    // directories BEFORE creating the container. Doing this first means a
    // barrier failure (agent error or timeout) aborts the job without ever
    // provisioning a CT — no orphaned, half-created container to clean up
    // (issue #421). The bind mounts (mpN) are applied after the CT exists.
    console.log('Preparing volumes...');
    const preparedVolumes = await prepareVolumes(client, node, container);

    // Allocate the provider ID right before creating to minimize race condition window.
    // Proxmox requires us to allocate a VMID first; Docker returns its real container
    // ID after create.
    let vmid = null;
    if (isDockerNode) {
      console.log('Docker node selected; Docker will allocate the container ID during create.');
    } else {
      console.log('Allocating VMID from Proxmox...');
      vmid = await client.nextId();
      console.log(`Allocated VMID: ${vmid}`);
    }
    
    if (isDocker) {
      // Docker image: pull from OCI registry, then create container
      const parsed = parseDockerRef(container.template);
      console.log(`Docker image: ${parsed.registry}/${parsed.namespace}/${parsed.image}:${parsed.tag}`);
      
      const templateStorage = await resolveStorage(client, node.name, node.imageStorage || 'local', 'vztmpl');
      const rootfsStorage = await resolveStorage(client, node.name, node.volumeStorage || 'local-lvm', 'rootdir');
      console.log(`Using template storage: ${templateStorage}, rootfs storage: ${rootfsStorage}`);
      
      // Get image digest from registry to create unique filename
      const repo = parsed.namespace ? `${parsed.namespace}/${parsed.image}` : parsed.image;
      console.log(`Fetching digest for ${parsed.registry}/${repo}:${parsed.tag}...`);
      const digest = await getImageDigest(parsed.registry, repo, parsed.tag);
      console.log(`Image digest: ${digest}`);
      
      const filename = generateImageFilename(parsed, digest);
      console.log(`Target filename: ${filename}`);
      
      // Check if image already exists in storage
      const existingContents = await client.storageContents(node.name, templateStorage, 'vztmpl');
      const expectedVolid = `${templateStorage}:vztmpl/${filename}.tar`;
      const imageExists = existingContents.some(item => item.volid === expectedVolid);
      
      if (imageExists) {
        console.log(`Image already exists in storage: ${expectedVolid}`);
      } else {
        // Pull the image from OCI registry
        const imageRef = container.template;
        console.log(`Pulling image ${imageRef}...`);
        const pullUpid = await client.pullOciImage(node.name, templateStorage, {
          reference: imageRef,
          filename
        });
        console.log(`Pull task started: ${pullUpid}`);
        
        // Wait for pull to complete
        await client.waitForTask(node.name, pullUpid);
        console.log('Image pulled successfully');
      }
      
      // Create container from the pulled image (Proxmox adds .tar to the filename)
      console.log(`Creating container from ${filename}.tar...`);
      const ostemplate = `${templateStorage}:vztmpl/${filename}.tar`;
      const createUpid = await client.createLxc(node.name, {
        vmid,
        hostname: container.hostname,
        ostemplate,
        description: `Created from Docker image ${container.template}`,
        cores,
        features: 'nesting=1,keyctl=1,fuse=1',
        memory,
        net0: `name=eth0,ip=dhcp,bridge=${node.networkBridge}`,
        searchdomain: site.internalDomain,
        swap,
        onboot: 1,
        tags: container.username,
        unprivileged: 1,
        rootfs: `${rootfsStorage}:${rootfsSize}`,
        // Volumes (bind mounts) are applied after creation; their host
        // directories were provisioned by the agent before this point (see
        // prepareVolumes above). Setting mpN here would 400 against a
        // not-yet-created directory (issue #421).
      });
      console.log(`Create task started: ${createUpid}`);

      if (isDockerNode) {
        const dockerContainerId = parseDockerTaskId(createUpid, 'create');
        if (!dockerContainerId) {
          throw new Error(`Docker create did not return a container ID: ${createUpid}`);
        }

        vmid = dockerContainerId;
        console.log(`Docker container ID: ${vmid}`);
      }
      
      // Wait for create to complete
      await client.waitForTask(node.name, createUpid);
      console.log('Container created successfully');
      
    } else {
      // Proxmox template: clone existing container
      console.log(`Looking for template: ${container.template}`);
      const templates = await client.getLxcTemplates(node.name);
      const templateContainer = templates.find(t => t.name === container.template);
      
      if (!templateContainer) {
        throw new Error(`Template "${container.template}" not found on node ${node.name}`);
      }
      
      const templateVmid = templateContainer.vmid;
      console.log(`Found template VMID: ${templateVmid}`);
      
      const rootfsStorage = await resolveStorage(client, node.name, node.volumeStorage || 'local-lvm', 'rootdir');
      console.log(`Using rootfs storage: ${rootfsStorage}`);

      // Clone the template
      console.log(`Cloning template ${templateVmid} to VMID ${vmid}...`);
      const cloneUpid = await client.cloneLxc(node.name, templateVmid, vmid, {
        hostname: container.hostname,
        description: `Cloned from template ${container.template}`,
        full: 1,
        storage: rootfsStorage
      });
      console.log(`Clone task started: ${cloneUpid}`);
      
      // Wait for clone to complete
      await client.waitForTask(node.name, cloneUpid);
      console.log('Clone completed successfully');
      
      // Configure the container (Docker containers are configured at creation time).
      // Volumes (bind mounts) are applied later, after the agent creates their
      // host directories (issue #421).
      console.log('Configuring container...');
      await client.updateLxcConfig(node.name, vmid, {
        cores,
        features: 'nesting=1,keyctl=1,fuse=1',
        memory,
        net0: `name=eth0,ip=dhcp,bridge=${node.networkBridge}`,
        searchdomain: site.internalDomain,
        swap,
        onboot: 1,
        tags: container.username,
      });
      console.log('Container configured');
    }
    
    // Snapshot the template's env/entrypoint onto the container record now, as
    // if the user had supplied them (user-supplied values still win). Templates
    // are mutable Docker refs we can't re-query on a later reconfigure, so we
    // persist them here; otherwise a future reconfigure (which uses
    // deleteMissing) would unset template-provided values that were never
    // stored. System/NVIDIA defaults are intentionally left out — they stay
    // configure-time-only.
    const templateConfig = await client.lxcConfig(node.name, vmid);
    await container.persistTemplateDefaults(templateConfig);

    // Apply environment variables and entrypoint. Use the default
    // (deleteMissing=false): only explicit values are pushed, nothing is unset.
    // The record now already includes the template's values, and system/NVIDIA
    // defaults are merged in by buildLxcEnvConfig.
    const envConfig = await container.buildLxcEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      console.log('Applying environment variables and entrypoint...');
      const updateTask = await client.updateLxcConfig(node.name, vmid, envConfig);
      const updatedDockerContainerId = isDockerNode ? parseDockerTaskId(updateTask) : null;
      if (updatedDockerContainerId) {
        vmid = updatedDockerContainerId;
        console.log(`Docker container ID after reconfigure: ${vmid}`);
      }
      console.log('Environment/entrypoint configuration applied');
    }
    
    // Attach NVIDIA hookscript when GPU passthrough is requested
    if (container.nvidiaRequested) {
      const hookscriptVolid = 'local:snippets/nvidia';
      console.log(`NVIDIA requested — attaching hookscript ${hookscriptVolid}...`);

      // Check if the hookscript file exists on the node
      try {
        const snippets = await client.storageContents(node.name, 'local', 'snippets');
        const hookExists = snippets.some(item => item.volid === hookscriptVolid);
        if (!hookExists) {
          console.warn('⚠️  WARNING: nvidia-container-toolkit hookscript not found at local:snippets/nvidia.');
          console.warn('   NVIDIA GPU passthrough may not function. See admin docs for setup instructions.');
        }
      } catch (snippetErr) {
        console.warn('⚠️  WARNING: Could not verify nvidia hookscript availability:', snippetErr.message);
        console.warn('   NVIDIA GPU passthrough may not function. See admin docs for setup instructions.');
      }

      const nvidiaUpdateTask = await client.updateLxcConfig(node.name, vmid, { hookscript: hookscriptVolid });
      const updatedDockerContainerId = isDockerNode ? parseDockerTaskId(nvidiaUpdateTask) : null;
      if (updatedDockerContainerId) {
        vmid = updatedDockerContainerId;
        console.log(`Docker container ID after NVIDIA update: ${vmid}`);
      }
      console.log('NVIDIA hookscript attached');
    }

    // Setup ACL for container owner
    await setupContainerAcl(client, node.name, vmid, container.username);
    
    // Store the provider container ID now that creation succeeded.
    await container.update({ containerId: String(vmid) });
    console.log(`Container provider ID ${vmid} stored in database`);

    // Attach the volume bind mounts. Their host directories were already
    // provisioned by the site agent before the container was created (see
    // prepareVolumes above), so setting mpN cannot 400 on a missing directory.
    if (preparedVolumes.length > 0) {
      const mountConfig = Volume.buildMountConfig(preparedVolumes);
      console.log(`Attaching ${preparedVolumes.length} volume(s): ${JSON.stringify(mountConfig)}`);
      const mountTask = await client.updateLxcConfig(node.name, vmid, mountConfig);
      const mountedDockerId = isDockerNode ? parseDockerTaskId(mountTask) : null;
      if (mountedDockerId) {
        vmid = mountedDockerId;
        await container.update({ containerId: String(vmid) });
        console.log(`Docker container ID after volume attach: ${vmid}`);
      }
      // Mark all volumes applied now that the mounts are set.
      await Volume.update(
        { appliedAt: new Date() },
        { where: { containerId: container.id } },
      );
      console.log('Volumes attached');
    }
    
    // Start the container
    console.log('Starting container...');
    const startUpid = await client.startLxc(node.name, vmid);
    console.log(`Start task started: ${startUpid}`);
    
    // Wait for start to complete
    await client.waitForTask(node.name, startUpid);
    console.log('Container started successfully');
    
    // Get MAC address from config
    const macAddress = await client.getLxcMacAddress(node.name, vmid);
    
    if (!macAddress) {
      throw new Error('Could not extract MAC address from container configuration');
    }
    
    // Read back configuration from Proxmox.
    console.log('Querying container configuration...');
    const config = await client.lxcConfig(node.name, vmid);

    // Read back the actual provisioned resources so downstream systems
    // (e.g. NetBox) mirror what the container really has rather than assuming
    // the values requested at creation time.
    const actualCores = config['cores'] != null ? parseInt(config['cores'], 10) : null;
    const actualMemoryMb = config['memory'] != null ? parseInt(config['memory'], 10) : null;
    const actualDiskGb = parseRootfsSizeGb(config['rootfs']);

    // Get IP address from Proxmox interfaces API
    const ipv4Address = await client.getLxcIpAddress(node.name, vmid);
    
    if (!ipv4Address) {
      throw new Error('Could not get IP address from Proxmox interfaces API');
    }
    
    // Update the container record
    console.log('Updating container record...');
    await container.update({
      macAddress,
      ipv4Address
    });
    
    console.log('Container creation completed successfully!');
    console.log(`  Hostname: ${container.hostname}`);
    console.log(`  Provider ID: ${vmid}`);
    console.log(`  MAC: ${macAddress}`);
    console.log(`  IP: ${ipv4Address}`);
    console.log(`  Status: running`);
    
    // Create Cloudflare DNS records for cross-site HTTP services
    const services = await Service.findAll({
      where: { containerId: container.id, type: 'http' },
      include: [{ model: HTTPService, as: 'httpService', include: [{ model: ExternalDomain, as: 'externalDomain' }] }]
    });
    const httpServices = services
      .filter(s => s.httpService?.externalDomain)
      .map(s => ({ externalHostname: s.httpService.externalHostname, ExternalDomain: s.httpService.externalDomain }));
    if (httpServices.length > 0) {
      const warnings = await manageDnsRecords(httpServices, site);
      for (const w of warnings) console.warn(`[DNS WARNING] ${w}`);
    }

    // Register the container in NetBox if the integration is configured
    await withNetbox(Setting, async (baseUrl, token) => {
      console.log(`Registering container in NetBox (site: ${site.name})...`);
      try {
        await createVirtualMachine(baseUrl, token, {
          hostname: container.hostname,
          clusterName: site.name,
          ipv4Address,
          createdBy: container.username,
          nodeName: container.node?.name,
          vcpus: actualCores,
          memoryMb: actualMemoryMb,
          diskGb: actualDiskGb,
        });
        console.log(`NetBox: VM "${container.hostname}" created`);
      } catch (err) {
        console.warn(`NetBox: VM creation failed (non-fatal): ${err.message}`);
      }
    });

    process.exit(0);
  } catch (err) {
    console.error('Container creation failed:', err.message);
    
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
