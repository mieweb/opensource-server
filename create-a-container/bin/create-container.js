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
const { Container, Node, Site } = db;

// Load utilities
const { parseArgs } = require(path.join(__dirname, '..', 'utils', 'cli'));

/**
 * Check if a template is a Docker image reference (contains '/')
 * @param {string} template - The template string
 * @returns {boolean} True if Docker image, false if Proxmox template
 */
function isDockerImage(template) {
  return template.includes('/');
}

/**
 * Parse a normalized Docker image reference into components
 * Format: host/org/image:tag
 * @param {string} ref - The normalized Docker reference
 * @returns {object} Parsed components: { registry, namespace, image, tag }
 */
function parseDockerRef(ref) {
  // Split off tag
  const [imagePart, tag] = ref.split(':');
  const parts = imagePart.split('/');
  
  // Format is always host/org/image after normalization
  const registry = parts[0];
  const image = parts[parts.length - 1];
  const namespace = parts.slice(1, -1).join('/');
  
  return { registry, namespace, image, tag };
}

/**
 * Generate a filename for a pulled Docker image
 * Replaces special chars with underscores
 * Note: Proxmox automatically appends .tar, so we don't include it here
 * @param {object} parsed - Parsed Docker ref components
 * @returns {string} Sanitized filename (e.g., "docker.io_library_nginx_latest")
 */
function generateImageFilename(parsed) {
  const { registry, namespace, image, tag } = parsed;
  const sanitized = `${registry}_${namespace}_${image}_${tag}`.replace(/[/:]/g, '_');
  return sanitized;
}

/**
 * Query IP address from Proxmox interfaces API with retries
 * @param {ProxmoxApi} client - The Proxmox API client
 * @param {string} nodeName - The node name
 * @param {number} vmid - The container VMID
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} retryDelay - Delay between retries in ms
 * @returns {Promise<string|null>} The IPv4 address or null if not found
 */
async function getIpFromInterfaces(client, nodeName, vmid, maxRetries = 10, retryDelay = 3000) {
  console.log(`Querying IP address from Proxmox interfaces API...`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const interfaces = await client.lxcInterfaces(nodeName, vmid);
      
      // Find eth0 interface and get its IPv4 address
      const eth0 = interfaces.find(iface => iface.name === 'eth0');
      if (eth0 && eth0['ip-addresses']) {
        const ipv4 = eth0['ip-addresses'].find(addr => addr['ip-address-type'] === 'inet');
        if (ipv4 && ipv4['ip-address']) {
          console.log(`IP address found (attempt ${attempt}): ${ipv4['ip-address']}`);
          return ipv4['ip-address'];
        }
      }
      
      // Also check the 'inet' field as fallback
      if (eth0 && eth0.inet) {
        const ip = eth0.inet.split('/')[0];
        console.log(`IP address found from inet field (attempt ${attempt}): ${ip}`);
        return ip;
      }
      
      console.log(`IP address not yet available (attempt ${attempt}/${maxRetries})`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    } catch (err) {
      console.log(`Interfaces query attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  console.error(`Failed to get IP address after ${maxRetries} attempts`);
  return null;
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
      
      const filename = generateImageFilename(parsed);
      console.log(`Target filename: ${filename}`);
      
      const storage = node.imageStorage || 'local';
      console.log(`Using storage: ${storage}`);
      
      // Pull the image from OCI registry using full image reference
      const imageRef = container.template;
      console.log(`Pulling image ${imageRef}...`);
      const pullUpid = await client.pullOciImage(node.name, storage, {
        reference: imageRef,
        filename
      });
      console.log(`Pull task started: ${pullUpid}`);
      
      // Wait for pull to complete
      await client.waitForTask(node.name, pullUpid);
      console.log('Image pulled successfully');
      
      // Create container from the pulled image (Proxmox adds .tar to the filename)
      console.log(`Creating container from ${filename}.tar...`);
      const ostemplate = `${storage}:vztmpl/${filename}.tar`;
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
        storage: 'local-lvm'
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
      
      // Clone the template
      console.log(`Cloning template ${templateVmid} to VMID ${vmid}...`);
      const cloneUpid = await client.cloneLxc(node.name, templateVmid, vmid, {
        hostname: container.hostname,
        description: `Cloned from template ${container.template}`,
        full: 1
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
    
    // Apply environment variables and entrypoint if set
    const envConfig = container.buildLxcEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      console.log('Applying environment variables and entrypoint...');
      console.log('Config:', JSON.stringify(envConfig, null, 2));
      await client.updateLxcConfig(node.name, vmid, envConfig);
      console.log('Environment/entrypoint configuration applied');
    }
    
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
    console.log('Querying container configuration...');
    const config = await client.lxcConfig(node.name, vmid);
    const net0 = config['net0'];
    const macMatch = net0.match(/hwaddr=([0-9A-Fa-f:]+)/);
    
    if (!macMatch) {
      throw new Error('Could not extract MAC address from container configuration');
    }
    
    const macAddress = macMatch[1];
    console.log(`MAC address: ${macAddress}`);
    
    // Get IP address from Proxmox interfaces API
    const ipv4Address = await getIpFromInterfaces(client, node.name, vmid);
    
    if (!ipv4Address) {
      throw new Error('Could not get IP address from Proxmox interfaces API');
    }
    
    console.log(`IP address: ${ipv4Address}`);
    
    // Update the container record
    console.log('Updating container record...');
    await container.update({
      macAddress,
      ipv4Address,
      status: 'running'
    });
    
    console.log('Container creation completed successfully!');
    console.log(`  Hostname: ${container.hostname}`);
    console.log(`  VMID: ${vmid}`);
    console.log(`  MAC: ${macAddress}`);
    console.log(`  IP: ${ipv4Address}`);
    console.log(`  Status: running`);
    
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
