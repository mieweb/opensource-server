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
const { Container, Node, Site, Service, HTTPService, ExternalDomain } = db;

// Load utilities
const { parseArgs } = require(path.join(__dirname, '..', 'utils', 'cli'));
const { isDockerImage, parseDockerRef, getImageDigest } = require(path.join(__dirname, '..', 'utils', 'docker-registry'));
const { manageDnsRecords } = require(path.join(__dirname, '..', 'utils', 'cloudflare-dns'));

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
  
  if (container.status !== 'pending') {
    console.error(`Container is not in pending status (current: ${container.status})`);
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
  
  const isDocker = isDockerImage(container.template);
  console.log(`Template type: ${isDocker ? 'Docker image' : 'Proxmox template'}`);
  
  try {
    // Update status to 'creating'
    await container.update({ status: 'creating' });
    console.log('Status updated to: creating');
    
    // Get the Proxmox API client
    const client = await node.api();
    console.log('Proxmox API client initialized');
    
    // Allocate VMID right before creating to minimize race condition window
    console.log('Allocating VMID from Proxmox...');
    const vmid = await client.nextId();
    console.log(`Allocated VMID: ${vmid}`);
    
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
        cores: 4,
        features: 'nesting=1,keyctl=1,fuse=1',
        memory: 4096,
        net0: 'name=eth0,ip=dhcp,bridge=vmbr0,host-managed=1',
        searchdomain: site.internalDomain,
        swap: 0,
        onboot: 1,
        tags: container.username,
        unprivileged: 1,
        rootfs: `${rootfsStorage}:50`
      });
      console.log(`Create task started: ${createUpid}`);
      
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
      
      // Configure the container (Docker containers are configured at creation time)
      console.log('Configuring container...');
      await client.updateLxcConfig(node.name, vmid, {
        cores: 4,
        features: 'nesting=1,keyctl=1,fuse=1',
        memory: 4096,
        net0: 'name=eth0,ip=dhcp,bridge=vmbr0',
        searchdomain: site.internalDomain,
        swap: 0,
        onboot: 1,
        tags: container.username
      });
      console.log('Container configured');
    }
    
    // Apply environment variables and entrypoint
    // First read defaults from the image, then merge with user-specified values
    const defaultConfig = await client.lxcConfig(node.name, vmid);
    const defaultEntrypoint = defaultConfig['entrypoint'] || null;
    const defaultEnvStr = defaultConfig['env'] || null;
    
    // Parse default env vars
    let mergedEnvVars = {};
    if (defaultEnvStr) {
      const pairs = defaultEnvStr.split('\0');
      for (const pair of pairs) {
        const eqIndex = pair.indexOf('=');
        if (eqIndex > 0) {
          mergedEnvVars[pair.substring(0, eqIndex)] = pair.substring(eqIndex + 1);
        }
      }
    }
    
    // Merge user-specified env vars (user values override defaults)
    const userEnvVars = container.environmentVars ? JSON.parse(container.environmentVars) : {};
    mergedEnvVars = { ...mergedEnvVars, ...userEnvVars };
    
    // Use user entrypoint if specified, otherwise keep default
    const finalEntrypoint = container.entrypoint || defaultEntrypoint;
    
    // Build config to apply
    const envConfig = {};
    if (finalEntrypoint) {
      envConfig.entrypoint = finalEntrypoint;
    }
    if (Object.keys(mergedEnvVars).length > 0) {
      envConfig.env = Object.entries(mergedEnvVars)
        .map(([key, value]) => `${key}=${value}`)
        .join('\0');
    }
    
    if (Object.keys(envConfig).length > 0) {
      console.log('Applying environment variables and entrypoint...');
      if (defaultEntrypoint) console.log(`Default entrypoint: ${defaultEntrypoint}`);
      if (defaultEnvStr) console.log(`Default env vars: ${Object.keys(mergedEnvVars).length - Object.keys(userEnvVars).length} from image`);
      if (Object.keys(userEnvVars).length > 0) console.log(`User env vars: ${Object.keys(userEnvVars).length} overrides`);
      await client.updateLxcConfig(node.name, vmid, envConfig);
      console.log('Environment/entrypoint configuration applied');
    }
    
    // Setup ACL for container owner
    await setupContainerAcl(client, node.name, vmid, container.username);
    
    // Store the VMID now that creation succeeded
    await container.update({ containerId: vmid });
    console.log(`Container VMID ${vmid} stored in database`);
    
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
    
    // Read back entrypoint and environment variables from config
    console.log('Querying container configuration...');
    const config = await client.lxcConfig(node.name, vmid);
    const actualEntrypoint = config['entrypoint'] || null;
    const actualEnv = config['env'] || null;
    
    // Parse NUL-separated env string back to JSON object
    let environmentVars = {};
    if (actualEnv) {
      const pairs = actualEnv.split('\0');
      for (const pair of pairs) {
        const eqIndex = pair.indexOf('=');
        if (eqIndex > 0) {
          const key = pair.substring(0, eqIndex);
          const value = pair.substring(eqIndex + 1);
          environmentVars[key] = value;
        }
      }
    }
    
    if (actualEntrypoint) {
      console.log(`Entrypoint: ${actualEntrypoint}`);
    }
    if (Object.keys(environmentVars).length > 0) {
      console.log(`Environment variables: ${Object.keys(environmentVars).length} vars`);
    }
    
    // Get IP address from Proxmox interfaces API
    const ipv4Address = await client.getLxcIpAddress(node.name, vmid);
    
    if (!ipv4Address) {
      throw new Error('Could not get IP address from Proxmox interfaces API');
    }
    
    // Update the container record
    console.log('Updating container record...');
    await container.update({
      macAddress,
      ipv4Address,
      entrypoint: actualEntrypoint,
      environmentVars: JSON.stringify(environmentVars),
      status: 'running'
    });
    
    console.log('Container creation completed successfully!');
    console.log(`  Hostname: ${container.hostname}`);
    console.log(`  VMID: ${vmid}`);
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
    
    process.exit(0);
  } catch (err) {
    console.error('Container creation failed:', err.message);
    
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
