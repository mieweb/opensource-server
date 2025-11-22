const axios = require('axios');
const user = require('../models/user');

class ProxmoxApi {
  /**
   * Create an API client instance
   * @param {string} baseUrl 
   * @param {string} tokenId 
   * @param {string} secret 
   * @param {object} options 
   */
  constructor(baseUrl, tokenId = null, secret = null, options = {}) {
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
   * @param {boolean} propogate 
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
   * Get the list of Proxmox Nodes
   * @returns {Promise<object>} - The API response data
   */
  async nodes() {
    const response = await axios.get(`${this.baseUrl}/api2/json/nodes`, this.options);
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
   * Delete a container
   * @param {string} nodeName 
   * @param {number} containerId 
   * @param {boolena} force 
   * @param {boolean} purge 
   * @returns {Promise<object>} - The API response data
   */
  async deleteContainer(nodeName, containerId, force = false, purge = false) {
    if (!this.tokenId || !this.secret) {
      throw new Error('Token ID and secret are required for authentication.');
    }

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
}

module.exports = ProxmoxApi;
