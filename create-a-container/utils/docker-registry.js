/**
 * docker-registry.js
 * 
 * Utility functions for interacting with Docker/OCI registries.
 * Implements the Docker Registry HTTP API V2 specification.
 * Supports automatic token-based authentication challenges.
 */

const https = require('https');

/**
 * Low-level HTTP GET that returns status, headers, and body without throwing on 4xx
 * @param {string} url - The URL to fetch
 * @param {object} headers - Optional request headers
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
function httpGet(url, headers = {}, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      return reject(new Error('Too many redirects'));
    }
    
    let timedOut = false;
    const req = https.get(url, { headers }, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers.location;
        if (!location) {
          return reject(new Error(`Redirect without Location header (status ${res.statusCode})`));
        }
        // Follow redirect (without auth headers for CDN)
        return httpGet(location, {}, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (timedOut) return;
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', (err) => {
      if (!timedOut) reject(err);
    });
    req.setTimeout(120000, () => {
      timedOut = true;
      req.destroy();
      reject(new Error('Request timeout after 120 seconds'));
    });
  });
}

/**
 * Fetch JSON from a URL with optional headers (throws on non-2xx)
 * @param {string} url - The URL to fetch
 * @param {object} headers - Optional headers
 * @returns {Promise<object>} Parsed JSON response
 */
async function fetchJson(url, headers = {}) {
  const res = await httpGet(url, headers);
  if (res.statusCode >= 400) {
    throw new Error(`HTTP ${res.statusCode}: ${res.body}`);
  }
  if (!res.body || res.body.trim() === '') {
    throw new Error('Empty response body');
  }
  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${err.message}. Body: ${res.body.substring(0, 200)}`);
  }
}

/**
 * Parse a WWW-Authenticate Bearer challenge header
 * Example: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"
 * @param {string} header - The WWW-Authenticate header value
 * @returns {object|null} Parsed fields { realm, service, scope } or null if not Bearer
 */
function parseWwwAuthenticate(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  const params = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2];
  }
  return params;
}

/**
 * Fetch JSON from a registry URL with automatic token authentication
 * Implements the Docker Registry Token Authentication spec:
 *   1. Attempt the request
 *   2. If 401, parse WWW-Authenticate for Bearer challenge
 *   3. Request a token from the auth service
 *   4. Retry with the Bearer token
 * @param {string} url - The registry URL to fetch
 * @param {object} headers - Optional request headers
 * @returns {Promise<object>} Parsed JSON response
 */
async function authenticatedFetchJson(url, headers = {}) {
  const res = await httpGet(url, headers);

  if (res.statusCode === 200) {
    if (!res.body || res.body.trim() === '') {
      throw new Error('Empty response body from registry');
    }
    try {
      return JSON.parse(res.body);
    } catch (err) {
      throw new Error(`Failed to parse JSON response: ${err.message}`);
    }
  }

  if (res.statusCode !== 401) {
    throw new Error(`HTTP ${res.statusCode}: ${res.body}`);
  }

  // Parse the Bearer challenge from WWW-Authenticate header
  const challenge = parseWwwAuthenticate(res.headers['www-authenticate']);
  if (!challenge || !challenge.realm) {
    throw new Error(`Registry returned 401 but no Bearer challenge in WWW-Authenticate header`);
  }

  // Build token request URL with query parameters from the challenge
  const tokenUrl = new URL(challenge.realm);
  if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);
  if (challenge.scope) tokenUrl.searchParams.set('scope', challenge.scope);

  const tokenData = await fetchJson(tokenUrl.toString());
  if (!tokenData.token) {
    throw new Error('Auth service did not return a token');
  }

  // Retry the original request with the Bearer token
  headers['Authorization'] = `Bearer ${tokenData.token}`;
  const retryRes = await httpGet(url, headers);
  if (retryRes.statusCode >= 400) {
    throw new Error(`HTTP ${retryRes.statusCode} after auth: ${retryRes.body}`);
  }
  if (!retryRes.body || retryRes.body.trim() === '') {
    throw new Error('Empty response body after auth');
  }
  try {
    return JSON.parse(retryRes.body);
  } catch (err) {
    throw new Error(`Failed to parse authenticated response: ${err.message}`);
  }
}

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
 * Get the digest (sha256 hash) of a Docker/OCI image from the registry
 * Handles both single-arch and multi-arch (manifest list) images
 * @param {string} registry - Registry hostname (e.g., 'docker.io')
 * @param {string} repo - Repository (e.g., 'library/nginx')
 * @param {string} tag - Tag (e.g., 'latest')
 * @returns {Promise<string>} Short digest (first 12 chars of sha256)
 */
async function getImageDigest(registry, repo, tag) {
  const registryHost = registry === 'docker.io' ? 'registry-1.docker.io' : registry;
  
  // Fetch manifest with automatic registry auth challenge-response
  const acceptHeaders = {
    'Accept': [
      'application/vnd.docker.distribution.manifest.v2+json',
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
      'application/vnd.oci.image.index.v1+json'
    ].join(', ')
  };
  
  const manifestUrl = `https://${registryHost}/v2/${repo}/manifests/${tag}`;
  let manifest = await authenticatedFetchJson(manifestUrl, { ...acceptHeaders });
  
  // Handle manifest list (multi-arch) - select amd64/linux
  if (manifest.manifests && Array.isArray(manifest.manifests)) {
    const amd64Manifest = manifest.manifests.find(m => 
      m.platform?.architecture === 'amd64' && m.platform?.os === 'linux'
    );
    if (!amd64Manifest) {
      throw new Error('No amd64/linux manifest found in manifest list');
    }
    
    // Fetch the actual manifest for amd64 (reuse same auth flow)
    const archHeaders = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
    };
    const archManifestUrl = `https://${registryHost}/v2/${repo}/manifests/${amd64Manifest.digest}`;
    manifest = await authenticatedFetchJson(archManifestUrl, { ...archHeaders });
  }
  
  // Get config digest from manifest
  const configDigest = manifest.config?.digest;
  if (!configDigest) {
    throw new Error('No config digest in manifest');
  }
  
  // Return short hash (sha256:abc123... -> abc123...)
  const hash = configDigest.replace('sha256:', '');
  return hash.substring(0, 12);
}

/**
 * Fetch the image configuration blob from the registry
 * Contains metadata like EXPOSE, ENV, ENTRYPOINT, CMD
 * @param {string} registry - Registry hostname (e.g., 'docker.io')
 * @param {string} repo - Repository (e.g., 'library/nginx')
 * @param {string} tag - Tag (e.g., 'latest')
 * @returns {Promise<object>} Image config object
 */
async function getImageConfig(registry, repo, tag) {
  const registryHost = registry === 'docker.io' ? 'registry-1.docker.io' : registry;
  
  // First, fetch the manifest to get the config digest
  const acceptHeaders = {
    'Accept': [
      'application/vnd.docker.distribution.manifest.v2+json',
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
      'application/vnd.oci.image.index.v1+json'
    ].join(', ')
  };
  
  const manifestUrl = `https://${registryHost}/v2/${repo}/manifests/${tag}`;
  let manifest = await authenticatedFetchJson(manifestUrl, { ...acceptHeaders });
  
  // Handle manifest list (multi-arch) - select amd64/linux
  if (manifest.manifests && Array.isArray(manifest.manifests)) {
    const amd64Manifest = manifest.manifests.find(m => 
      m.platform?.architecture === 'amd64' && m.platform?.os === 'linux'
    );
    if (!amd64Manifest) {
      throw new Error('No amd64/linux manifest found in manifest list');
    }
    
    const archHeaders = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
    };
    const archManifestUrl = `https://${registryHost}/v2/${repo}/manifests/${amd64Manifest.digest}`;
    manifest = await authenticatedFetchJson(archManifestUrl, { ...archHeaders });
  }
  
  // Get config digest from manifest
  const configDigest = manifest.config?.digest;
  if (!configDigest) {
    throw new Error('No config digest in manifest');
  }
  
  // Fetch the config blob
  const blobUrl = `https://${registryHost}/v2/${repo}/blobs/${configDigest}`;
  const config = await authenticatedFetchJson(blobUrl);
  
  return config;
}

/**
 * Extract metadata from image config for container creation
 * @param {object} config - Raw image config from registry
 * @returns {object} Structured metadata: { ports, httpServices, env, entrypoint }
 */
function extractImageMetadata(config) {
  const metadata = {
    ports: [],
    httpServices: [],
    env: {},
    entrypoint: ''
  };
  
  // Extract HTTP service from OCI labels first
  // Label: org.mieweb.opensource-server.services.http.default-port
  let httpServicePort = null;
  if (config.config?.Labels) {
    const httpPortLabel = config.config.Labels['org.mieweb.opensource-server.services.http.default-port'];
    if (httpPortLabel) {
      const port = parseInt(httpPortLabel, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        httpServicePort = port;
        metadata.httpServices.push({
          port: port
        });
      }
    }
  }
  
  // Extract exposed ports (excluding HTTP service port on TCP to avoid duplicates)
  // Format: { "80/tcp": {}, "443/tcp": {}, "8080/udp": {} }
  if (config.config?.ExposedPorts) {
    for (const portSpec of Object.keys(config.config.ExposedPorts)) {
      const [port, protocol = 'tcp'] = portSpec.split('/');
      const portNum = parseInt(port, 10);
      
      // Skip if this port is designated as an HTTP service AND it's TCP
      // (HTTP runs over TCP, but keep UDP ports even if same number)
      if (portNum === httpServicePort && protocol.toLowerCase() === 'tcp') {
        continue;
      }
      
      metadata.ports.push({
        port: portNum,
        protocol: protocol.toLowerCase()
      });
    }
  }
  
  // Extract environment variables
  // Format: ["KEY1=value1", "KEY2=value2", "PATH=/usr/bin"]
  const skipEnvVars = new Set(['PATH', 'HOME', 'HOSTNAME', 'TERM', 'USER']);
  if (config.config?.Env && Array.isArray(config.config.Env)) {
    for (const envStr of config.config.Env) {
      const eqIndex = envStr.indexOf('=');
      if (eqIndex > 0) {
        const key = envStr.substring(0, eqIndex);
        const value = envStr.substring(eqIndex + 1);
        if (!skipEnvVars.has(key)) {
          metadata.env[key] = value;
        }
      }
    }
  }
  
  // Extract and concatenate ENTRYPOINT + CMD
  // Both are arrays of strings
  const entrypointParts = [];
  if (config.config?.Entrypoint && Array.isArray(config.config.Entrypoint)) {
    entrypointParts.push(...config.config.Entrypoint);
  }
  if (config.config?.Cmd && Array.isArray(config.config.Cmd)) {
    entrypointParts.push(...config.config.Cmd);
  }
  if (entrypointParts.length > 0) {
    metadata.entrypoint = entrypointParts.join(' ');
  }
  
  return metadata;
}

module.exports = {
  httpGet,
  fetchJson,
  parseWwwAuthenticate,
  authenticatedFetchJson,
  isDockerImage,
  parseDockerRef,
  getImageDigest,
  getImageConfig,
  extractImageMetadata
};
