/**
 * Traefik configuration utilities
 */

const path = require('path');
const os = require('os');
const db = require('../models');

const ZEROSSL_ACME_URL = 'https://acme.zerossl.com/v2/DV90';

/**
 * Fetch ZeroSSL EAB credentials for a given email
 * @param {string} email - Email address for EAB credentials
 * @returns {Promise<{kid: string, hmac: string}|null>} EAB credentials or null on failure
 */
async function getZeroSslEabCredentials(email) {
  try {
    console.log(`Fetching ZeroSSL EAB credentials for ${email}...`);
    const response = await fetch('https://api.zerossl.com/acme/eab-credentials-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email })
    });
    
    const data = await response.json();
    
    if (data.success && data.eab_kid && data.eab_hmac_key) {
      console.log('ZeroSSL EAB credentials retrieved successfully');
      return {
        kid: data.eab_kid,
        hmac: data.eab_hmac_key
      };
    }
    
    console.error('ZeroSSL EAB response missing required fields:', data);
    return null;
  } catch (err) {
    console.error('Failed to fetch ZeroSSL EAB credentials:', err.message);
    return null;
  }
}

/**
 * Get the base URL for Traefik HTTP provider
 * Falls back to http://<local-ip>:3000 if not configured
 * @returns {Promise<string>} Base URL
 */
async function getBaseUrl() {
  const baseUrl = await db.Setting.get('base_url');
  if (baseUrl && baseUrl.trim()) {
    return baseUrl.trim();
  }

  // Fallback: use first non-internal IPv4 address
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return `http://${iface.address}:3000`;
      }
    }
  }

  // Last resort fallback
  return 'http://localhost:3000';
}

/**
 * Sanitize a domain name for use as a Traefik certificate resolver name
 * Replaces dots and hyphens with underscores for valid identifier
 * @param {string} domain - Domain name (e.g., 'example.com')
 * @returns {string} Sanitized name (e.g., 'example_com')
 */
function sanitizeDomainForResolver(domain) {
  return domain.replace(/[.-]/g, '_');
}

/**
 * Queue a Traefik configuration job for a site
 * Only queues if no pending job exists for the same site
 * @param {number} siteId - Site ID
 * @param {string} [createdBy] - Username of who triggered the job
 * @returns {Promise<object|null>} Created job or null if already pending
 */
async function queueTraefikConfigJob(siteId, createdBy = null) {
  const serialGroup = `traefik-config-${siteId}`;

  // Check if a pending job already exists for this site
  const existingPending = await db.Job.findOne({
    where: {
      serialGroup,
      status: 'pending'
    }
  });

  if (existingPending) {
    console.log(`Traefik config job already pending for site ${siteId}`);
    return null;
  }

  // Create the job
  const job = await db.Job.create({
    command: `node bin/configure-traefik.js --site-id=${siteId}`,
    createdBy,
    serialGroup
  });

  console.log(`Queued Traefik config job ${job.id} for site ${siteId}`);
  return job;
}

/**
 * Get the lowest UID user from the first admin group
 * Used for assigning ownership of system containers
 * @returns {Promise<string|null>} Username (uid) or null if no admin users exist
 */
async function getSystemContainerOwner() {
  // Find first admin group
  const adminGroup = await db.Group.findOne({
    where: { isAdmin: true },
    order: [['gidNumber', 'ASC']],
    include: [{
      model: db.User,
      as: 'users',
      through: { attributes: [] }
    }]
  });

  if (!adminGroup || !adminGroup.users || adminGroup.users.length === 0) {
    return null;
  }

  // Sort by uidNumber and return lowest
  const sortedUsers = adminGroup.users.sort((a, b) => a.uidNumber - b.uidNumber);
  return sortedUsers[0].uid;
}

/**
 * Build Traefik CLI flags for static configuration
 * @param {number} siteId - Site ID
 * @param {object} site - Site with externalDomains and transport services
 * @param {string} baseUrl - Base URL for HTTP provider
 * @returns {Promise<string[]>} Array of CLI flags
 */
async function buildTraefikCliFlags(siteId, site, baseUrl) {
  const flags = [];

  // Logging
  flags.push('--log.level=DEBUG');
  flags.push('--accesslog=true');

  // HTTP provider
  flags.push(`--providers.http.endpoint=${baseUrl}/sites/${siteId}/traefik.json`);
  flags.push('--providers.http.pollInterval=10s');

  // Web entrypoint (HTTP -> HTTPS redirect)
  flags.push('--entrypoints.web.address=:80');
  flags.push('--entrypoints.web.http.redirections.entryPoint.to=websecure');
  flags.push('--entrypoints.web.http.redirections.entryPoint.scheme=https');

  // Websecure entrypoint (HTTPS)
  flags.push('--entrypoints.websecure.address=:443');
  flags.push('--entrypoints.websecure.http.tls=true');

  // Certificate resolvers for each external domain
  for (const domain of site.externalDomains || []) {
    const resolverName = sanitizeDomainForResolver(domain.name);

    if (domain.acmeEmail) {
      flags.push(`--certificatesresolvers.${resolverName}.acme.email=${domain.acmeEmail}`);
    }

    if (domain.acmeDirectoryUrl) {
      flags.push(`--certificatesresolvers.${resolverName}.acme.caServer=${domain.acmeDirectoryUrl}`);
      
      // ZeroSSL requires EAB credentials
      if (domain.acmeDirectoryUrl === ZEROSSL_ACME_URL && domain.acmeEmail) {
        const eab = await getZeroSslEabCredentials(domain.acmeEmail);
        if (eab) {
          flags.push(`--certificatesresolvers.${resolverName}.acme.eab.kid=${eab.kid}`);
          flags.push(`--certificatesresolvers.${resolverName}.acme.eab.hmacEncoded=${eab.hmac}`);
        } else {
          console.warn(`Warning: Could not fetch ZeroSSL EAB credentials for ${domain.name}, certificate issuance may fail`);
        }
      }
    }

    // Certificate storage path inside container
    flags.push(`--certificatesresolvers.${resolverName}.acme.storage=/acme/${resolverName}.json`);

    // DNS challenge with Cloudflare if credentials provided
    if (domain.cloudflareApiEmail && domain.cloudflareApiKey) {
      flags.push(`--certificatesresolvers.${resolverName}.acme.dnsChallenge.provider=cloudflare`);
    } else {
      // Fallback to HTTP challenge
      flags.push(`--certificatesresolvers.${resolverName}.acme.httpChallenge.entryPoint=web`);
    }
  }

  // Collect transport services for TCP/UDP entrypoints
  const transportServices = [];
  for (const node of site.nodes || []) {
    for (const container of node.containers || []) {
      for (const service of container.services || []) {
        if (service.type === 'transport' && service.transportService) {
          transportServices.push(service.transportService);
        }
      }
    }
  }

  // Create entrypoints for each transport service
  for (const ts of transportServices) {
    const protocol = ts.protocol;
    const port = ts.externalPort;
    const entryPointName = `${protocol}-${port}`;

    if (protocol === 'udp') {
      flags.push(`--entrypoints.${entryPointName}.address=:${port}/udp`);
    } else {
      flags.push(`--entrypoints.${entryPointName}.address=:${port}`);
    }
  }

  return flags;
}

module.exports = {
  getBaseUrl,
  sanitizeDomainForResolver,
  queueTraefikConfigJob,
  getSystemContainerOwner,
  buildTraefikCliFlags
};
