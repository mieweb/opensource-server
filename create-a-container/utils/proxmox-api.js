const axios = require('axios');

class ProxmoxApi {
  constructor(baseUrl, tokenId, secret, options = {}) {
    this.baseUrl = baseUrl;
    this.tokenId = tokenId;
    this.secret = secret;
    this.options = options;
  }

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
      headers: { 
        'Authorization': `PVEAPIToken=${this.tokenId}=${this.secret}`
      },
      params,
      ...this.options
    });

    return response.data;
  }
}

module.exports = ProxmoxApi;
