#!/usr/bin/env node
/**
 * configure-traefik.js
 * 
 * Background job script that generates Traefik static configuration and
 * manages the Traefik container lifecycle for a site.
 * 
 * Usage: node bin/configure-traefik.js --site-id=<id>
 * 
 * The script will:
 * 1. Load site configuration including external domains and transport services
 * 2. Generate Traefik CLI flags for static configuration
 * 3. Create or update the Traefik container:
 *    - If container doesn't exist: create it and queue a create-container job
 *    - If container exists: update entrypoint and queue a reconfigure-container job
 * 
 * All output is logged to STDOUT for capture by the job-runner.
 * Exit code 0 = success, non-zero = failure.
 */

const path = require('path');

// Load models from parent directory
const db = require(path.join(__dirname, '..', 'models'));
const { Site, Node, Container, Service, TransportService, ExternalDomain, Job } = db;

// Load utilities
const { parseArgs } = require(path.join(__dirname, '..', 'utils', 'cli'));
const { 
  getBaseUrl, 
  getSystemContainerOwner, 
  buildTraefikCliFlags 
} = require(path.join(__dirname, '..', 'utils', 'traefik'));

const TRAEFIK_HOSTNAME = 'traefik';
const TRAEFIK_IMAGE = 'docker.io/library/traefik:v3.0';

/**
 * Main function
 */
async function main() {
  const args = parseArgs();
  
  if (!args['site-id']) {
    console.error('Usage: node configure-traefik.js --site-id=<id>');
    process.exit(1);
  }
  
  const siteId = parseInt(args['site-id'], 10);
  console.log(`Starting Traefik configuration for site ID: ${siteId}`);
  
  // Load site with all necessary associations
  const site = await Site.findByPk(siteId, {
    include: [
      {
        model: ExternalDomain,
        as: 'externalDomains'
      },
      {
        model: Node,
        as: 'nodes',
        include: [{
          model: Container,
          as: 'containers',
          include: [{
            model: Service,
            as: 'services',
            include: [{
              model: TransportService,
              as: 'transportService'
            }]
          }]
        }]
      }
    ]
  });
  
  if (!site) {
    console.error(`Site with ID ${siteId} not found`);
    process.exit(1);
  }
  
  console.log(`Site: ${site.name} (${site.internalDomain})`);
  console.log(`External domains: ${site.externalDomains?.length || 0}`);
  
  // Get base URL for HTTP provider
  const baseUrl = await getBaseUrl();
  console.log(`Base URL: ${baseUrl}`);
  
  // Build Traefik CLI flags
  const cliFlags = await buildTraefikCliFlags(siteId, site, baseUrl);
  console.log(`Generated ${cliFlags.length} CLI flags`);
  
  // Build entrypoint command
  const entrypoint = `traefik ${cliFlags.join(' ')}`;
  console.log(`Entrypoint: ${entrypoint.substring(0, 100)}...`);
  
  // Build environment variables for Cloudflare DNS challenge
  const envVars = {};
  for (const domain of site.externalDomains || []) {
    if (domain.cloudflareApiEmail && domain.cloudflareApiKey) {
      envVars['CF_API_EMAIL'] = domain.cloudflareApiEmail;
      envVars['CF_API_KEY'] = domain.cloudflareApiKey;
      break; // Traefik uses global env vars for Cloudflare
    }
  }
  
  // Find existing Traefik container for this site
  let traefikContainer = null;
  for (const node of site.nodes || []) {
    const existing = node.containers?.find(c => c.hostname === TRAEFIK_HOSTNAME);
    if (existing) {
      traefikContainer = existing;
      break;
    }
  }
  
  if (traefikContainer) {
    console.log(`Found existing Traefik container (ID: ${traefikContainer.id}, Node: ${traefikContainer.nodeId})`);
    
    // Update the container's entrypoint and environment variables
    await traefikContainer.update({
      entrypoint,
      environmentVars: Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null
    });
    console.log('Updated container configuration');
    
    // Queue a reconfigure job to restart the container
    const reconfigureJob = await Job.create({
      command: `node bin/reconfigure-container.js --container-id=${traefikContainer.id}`,
      createdBy: 'system',
      serialGroup: `traefik-config-${siteId}`
    });
    console.log(`Queued reconfigure job ${reconfigureJob.id}`);
    
  } else {
    console.log('No existing Traefik container found, creating new one');
    
    // Find a node in this site to run the container
    const availableNode = site.nodes?.[0];
    if (!availableNode) {
      console.error('No nodes available in this site');
      process.exit(1);
    }
    console.log(`Selected node: ${availableNode.name} (ID: ${availableNode.id})`);
    
    // Get owner for the container
    const owner = await getSystemContainerOwner();
    if (!owner) {
      console.error('No admin users found to assign as container owner');
      process.exit(1);
    }
    console.log(`Container owner: ${owner}`);
    
    // Create the container record
    const newContainer = await Container.create({
      hostname: TRAEFIK_HOSTNAME,
      username: owner,
      status: 'pending',
      template: TRAEFIK_IMAGE,
      nodeId: availableNode.id,
      entrypoint,
      environmentVars: Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null
    });
    console.log(`Created container record (ID: ${newContainer.id})`);
    
    // Queue a create-container job
    const createJob = await Job.create({
      command: `node bin/create-container.js --container-id=${newContainer.id}`,
      createdBy: 'system',
      serialGroup: `traefik-config-${siteId}`
    });
    console.log(`Queued create-container job ${createJob.id}`);
    
    // Link the creation job to the container
    await newContainer.update({ creationJobId: createJob.id });
  }
  
  console.log('Traefik configuration completed successfully!');
  process.exit(0);
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
