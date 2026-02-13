const axios = require('axios');
const { URL } = require('url');

/**
 * 
 * @param {string} urlString 
 * @returns {boolean}
 */
function validateUrl(urlString) {
  try {
    const url = new URL(urlString);
    return ['https:', 'http:'].includes(url.protocol);
  } catch (err) {
    return false;
  }
}

class ProxmoxApi {
  /**
   * Create an API client instance
   * @param {string} baseUrl 
   * @param {string} tokenId 
   * @param {string} secret 
   * @param {object} options 
   */
  constructor(baseUrl, tokenId = null, secret = null, options = {}) {
    if (!validateUrl(baseUrl)) {
      throw new Error('Invalid Proxmox API URL');
    }

    this.baseUrl = baseUrl;
    this.options = options;
    if (tokenId && secret) {
      this.options.headers ??= {};
      this.options.headers['Authorization'] = `PVEAPIToken=${tokenId}=${secret}`;
    }
  }
  
  /**
   * Authenticate to the API
   * @param {string} username 
   * @param {string} password 
   * @returns {Promise<void>}
   */
  async authenticate(username, password) {
    if (!/^[-_.a-zA-Z0-9]+@[a-zA-Z0-9]+$/.test(username)) {
      throw new Error('Invalid username format');
    }

    const response = await axios.post(`${this.baseUrl}/api2/json/access/ticket`, {
      username,
      password
    }, this.options);
    const data = response.data.data;
    this.options ??= {};
    this.options.headers ??= {};
    this.options.headers['Cookie'] = `PVEAuthCookie=${data.ticket}`;
    this.options.headers['CSRFPreventionToken'] = data.CSRFPreventionToken;
  }

  /**
   * Create an API token for a user
   * @param {string} userId 
   * @param {string} tokenId 
   * @param {string|null} comment 
   * @param {number|null} expire 
   * @param {boolean} privsep 
   * @returns {Promise<object>} - The created token data
   */
  async createApiToken(userId, tokenId, comment = null, expire = 0, privsep = true) {
    const response = await axios.post(
      `${this.baseUrl}/api2/json/access/users/${userId}/token/${tokenId}`,
      { comment, expire, privsep: privsep ? 1 : 0 },
      this.options
    );
    return response.data.data;
  }

  /**
   * Update an ACL entry
   * @param {string} path 
   * @param {string} roles 
   * @param {string|null} groups 
   * @param {boolean} propagate 
   * @param {string|null} tokens 
   * @param {string|null} users 
   * @returns {Promise<void>}
   */
  async updateAcl(path, roles, groups = null, propagate = true, tokens = null, users = null) {
    const response = await axios.put(
      `${this.baseUrl}/api2/json/access/acl`,
      { path, roles, groups, propagate: propagate ? 1 : 0, tokens, users },
      this.options
    );
  }

  /**
   * Sync LDAP realm to update user list from LDAP server
   * @param {string} realm - The realm name (e.g., 'ldap')
   * @returns {Promise<void>}
   */
  async syncLdapRealm(realm = 'ldap') {
    const response = await axios.post(
      `${this.baseUrl}/api2/json/access/domains/${realm}/sync`,
      {},
      this.options
    );
    return response.data.data;
  }

  /**
   * Get the list of Proxmox Nodes
   * @returns {Promise<object>} - The API response data
   */
  async nodes() {
    const response = await axios.get(`${this.baseUrl}/api2/json/nodes`, this.options);
    return response.data.data;
  }

  /**
   * Get node network configuration
   * @param {string} node - The node name
   * @returns {Promise<object>} - The API response data
   */
  async nodeNetwork(node) {
    const response = await axios.get(`${this.baseUrl}/api2/json/nodes/${node}/network`, this.options);
    return response.data.data;
  }

  /**
   * Get cluster resources
   * @param {'node'|'storage'|'pool'|'qemu'|'lxc'|'openvz'|'sdn'|'network'|'vm'} type 
   * @returns {Promise<object>} - The API response data
   */
  async clusterResources(type = null) {
    const rawTypes = ['vm', 'storage', 'node', 'sdn'];
    const typeMap = {
      'node': 'node',
      'storage': 'storage',
      'pool': 'storage',
      'qemu': 'vm',
      'lxc': 'vm',
      'openvz': 'vm',
      'sdn': 'sdn',
      'network': 'sdn'
    };
    const typeParam = type && typeMap[type];
    const url = `${this.baseUrl}/api2/json/cluster/resources${typeParam ? `?type=${typeParam}` : ''}`;
    const response = await axios.get(url, this.options);
    if (rawTypes.includes(type)) {
      return response.data.data;
    }

    return response.data.data.filter(r => r.type === type);
  }

  /**
   * Get container configuration
   * @param {string} node 
   * @param {number} vmid 
   * @returns {Promise<object>} - The API response data
   */
  async lxcConfig(node, vmid) {
    const response = await axios.get(`${this.baseUrl}/api2/json/nodes/${node}/lxc/${vmid}/config`, this.options);
    return response.data.data;    
  }

  /**
   * Get status for all datastores
   * @param {string} node 
   * @param {string} content 
   * @param {boolean} enabled 
   * @param {boolean} format 
   * @param {string} storage 
   * @param {string} target 
   * @returns {Promise<object>} - The API response data
   */
  async datastores(node, content = null, enabled = false, format = false, storage = null, target = null) {
    const params = {};
    if (content) params.content = content;
    if (enabled) params.enabled = 1;
    if (format) params.format = 1;
    if (storage) params.storage = storage;
    if (target) params.target = target;
    const response = await axios.get(`${this.baseUrl}/api2/json/nodes/${node}/storage`, {
      params,
      ...this.options
    });
    return response.data.data;
  }

  /**
   * Get storage contents
   * @param {string} node 
   * @param {string} storage 
   * @param {string} content - Content type filter (e.g., 'vztmpl' for container templates)
   * @returns {Promise<object>} - The API response data
   */
  async storageContents(node, storage, content = null) {
    const params = {};
    if (content) params.content = content;
    const response = await axios.get(
      `${this.baseUrl}/api2/json/nodes/${node}/storage/${storage}/content`,
      {
        params,
        ...this.options
      }
    );
    return response.data.data;
  }

  /**
   * @returns {Promise<number>} - The next available VMID
   */
  async nextId() {
    const response = await axios.get(`${this.baseUrl}/api2/json/cluster/nextid`, this.options);
    return response.data.data;
  }

  /**
   * Create or restore a container
   * @param {string} node 
   * @param {object} options 
   * @returns {Promise<string>} - The created container ID
   */
  async createLxc(node, options) {
    const response = await axios.post(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc`,
      {
        ...options
      },
      this.options
    );
    return response.data.data;
  }

  /**
   * Read task status
   * @param {string} node 
   * @param {string} upid 
   * @returns {Promise<object>} - The API response data
   */
  async taskStatus(node, upid) {
    const response = await axios.get(
      `${this.baseUrl}/api2/json/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`,
      this.options
    );
    return response.data.data;
  }

  /**
   * Wait for a Proxmox task to complete
   * @param {string} node - The node name
   * @param {string} upid - The task UPID
   * @param {number} pollInterval - Polling interval in ms (default 2000)
   * @param {number} timeout - Timeout in ms (default 300000 = 5 minutes)
   * @returns {Promise<object>} The final task status
   */
  async waitForTask(node, upid, pollInterval = 2000, timeout = 300000) {
    const startTime = Date.now();
    while (true) {
      const status = await this.taskStatus(node, upid);
      console.log(`Task ${upid}: status=${status.status}, exitstatus=${status.exitstatus || 'N/A'}`);
      
      if (status.status === 'stopped') {
        if (status.exitstatus && status.exitstatus !== 'OK') {
          throw new Error(`Task failed with status: ${status.exitstatus}`);
        }
        return status;
      }
      
      if (Date.now() - startTime > timeout) {
        throw new Error(`Task ${upid} timed out after ${timeout}ms`);
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Delete a container
   * @param {string} nodeName 
   * @param {number} containerId 
   * @param {boolena} force 
   * @param {boolean} purge 
   * @returns {Promise<object>} - The API response data
   */
  async deleteContainer(nodeName, containerId, force = false, purge = false) {
    const params = {};
    if (force) params.force = 1;
    if (purge) params.purge = 1;

    const response = await axios.request({
      method: 'delete',
      url: `${this.baseUrl}/api2/json/nodes/${nodeName}/lxc/${containerId}`,
      params,
      ...this.options
    });

    return response.data;
  }

  /**
   * Get LXC template containers on a node
   * @param {string} node - The node name
   * @returns {Promise<Array>} - Array of LXC templates
   */
  async getLxcTemplates(node) {
    const response = await axios.get(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc`,
      this.options
    );
    return response.data.data.filter(lxc => lxc.template === 1);
  }

  /**
   * Clone an LXC container from a template
   * @param {string} node - The node name
   * @param {number} vmid - The template container VMID to clone from
   * @param {number} newid - The new container VMID
   * @param {object} options - Additional options (hostname, description, storage, etc.)
   * @returns {Promise<string>} - The task UPID
   */
  async cloneLxc(node, vmid, newid, options = {}) {
    const response = await axios.post(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc/${vmid}/clone`,
      {
        newid,
        ...options
      },
      this.options
    );
    return response.data.data;
  }

  /**
   * Update LXC container configuration
   * @param {string} node - The node name
   * @param {number} vmid - The container VMID
   * @param {object} config - Configuration options to update
   * @returns {Promise<void>}
   */
  async updateLxcConfig(node, vmid, config) {
    await axios.put(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc/${vmid}/config`,
      config,
      this.options
    );
  }

  /**
   * Start an LXC container
   * @param {string} node - The node name
   * @param {number} vmid - The container VMID
   * @returns {Promise<string>} - The task UPID
   */
  async startLxc(node, vmid) {
    const response = await axios.post(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc/${vmid}/status/start`,
      {},
      this.options
    );
    return response.data.data;
  }

  /**
   * Stop an LXC container
   * @param {string} node - The node name
   * @param {number} vmid - The container VMID
   * @returns {Promise<string>} - The task UPID
   */
  async stopLxc(node, vmid) {
    const response = await axios.post(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc/${vmid}/status/stop`,
      {},
      this.options
    );
    return response.data.data;
  }

  /**
   * Get LXC container current status
   * @param {string} node - The node name
   * @param {number} vmid - The container VMID
   * @returns {Promise<Object>} - Container status object with status field ('running', 'stopped', etc.)
   */
  async getLxcStatus(node, vmid) {
    const response = await axios.get(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc/${vmid}/status/current`,
      this.options
    );
    return response.data.data;
  }

  /**
   * Get LXC container network interfaces
   * @param {string} node - The node name
   * @param {number} vmid - The container VMID
   * @returns {Promise<Array>} - Array of network interfaces
   */
  async lxcInterfaces(node, vmid) {
    const response = await axios.get(
      `${this.baseUrl}/api2/json/nodes/${node}/lxc/${vmid}/interfaces`,
      this.options
    );
    return response.data.data;
  }

  /**
   * Pull an OCI/Docker image from a registry to Proxmox storage
   * @param {string} node - The node name
   * @param {string} storage - The storage name (e.g., 'local')
   * @param {Object} options - Pull options
   * @param {string} options.reference - Full image reference (e.g., 'docker.io/library/nginx:latest')
   * @param {string} [options.filename] - Target filename (e.g., 'nginx_latest.tar')
   * @param {string} [options.username] - Registry username for private images
   * @param {string} [options.password] - Registry password for private images
   * @returns {Promise<string>} - UPID of the pull task
   */
  async pullOciImage(node, storage, options) {
    const response = await axios.post(
      `${this.baseUrl}/api2/json/nodes/${node}/storage/${storage}/oci-registry-pull`,
      options,
      this.options
    );
    return response.data.data;
  }

  /**
   * Get MAC address from container configuration
   * @param {string} node - Node name
   * @param {number} vmid - Container VMID
   * @returns {Promise<string|null>} - MAC address or null if not found
   */
  async getLxcMacAddress(node, vmid) {
    console.log('Querying container configuration for MAC address...');
    const config = await this.lxcConfig(node, vmid);
    const net0 = config['net0'];
    
    if (!net0) {
      console.log('No net0 configuration found');
      return null;
    }
    
    const macMatch = net0.match(/hwaddr=([0-9A-Fa-f:]+)/);
    if (macMatch) {
      console.log(`MAC address: ${macMatch[1]}`);
      return macMatch[1];
    }
    
    console.log('Could not extract MAC address from net0 configuration');
    return null;
  }

  /**
   * Get IPv4 address from container interfaces with retry logic
   * @param {string} node - Node name
   * @param {number} vmid - Container VMID
   * @param {number} maxRetries - Maximum retry attempts (default: 10)
   * @param {number} retryDelay - Delay between retries in ms (default: 3000)
   * @returns {Promise<string|null>} - IPv4 address or null if not found
   */
  async getLxcIpAddress(node, vmid, maxRetries = 10, retryDelay = 3000) {
    console.log('Querying IP address from Proxmox interfaces API...');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const interfaces = await this.lxcInterfaces(node, vmid);
        
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
   * Get both MAC and IP address for a container
   * @param {string} node - Node name
   * @param {number} vmid - Container VMID
   * @returns {Promise<{macAddress: string|null, ipv4Address: string|null}>}
   */
  async getLxcNetworkInfo(node, vmid) {
    const macAddress = await this.getLxcMacAddress(node, vmid);
    const ipv4Address = await this.getLxcIpAddress(node, vmid);
    
    return { macAddress, ipv4Address };
  }
}

module.exports = ProxmoxApi;
