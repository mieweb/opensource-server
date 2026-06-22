'use strict';
const {
  Model
} = require('sequelize');
const https = require('https');
const ProxmoxApi = require('../utils/proxmox-api');
const DummyApi = require('../utils/dummy-api');

module.exports = (sequelize, DataTypes) => {
  class Node extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // A node has many containers
      Node.hasMany(models.Container, { foreignKey: 'nodeId', as: 'containers' });
      
      // A node belongs to a site
      Node.belongsTo(models.Site, {
        foreignKey: 'siteId',
        as: 'site'
      });
    }

    /**
     * Create an API client for this node, selected by `nodeType`.
     *
     * - `proxmox` (default): returns an authenticated {@link ProxmoxApi}.
     *   Detects whether stored credentials are username/password or API token
     *   based on presence of '!' in tokenId (Proxmox convention).
     * - `dummy`: returns a {@link DummyApi} that simulates provisioning so the
     *   full create-container code path can run locally without a hypervisor.
     *
     * @returns {Promise<ProxmoxApi|DummyApi>} API client implementing the NodeApi surface
     * @throws {Error} If Proxmox configuration is missing or authentication fails (proxmox only)
     */
    async api() {
      // Dummy nodes have no real hypervisor; return the simulated client.
      if (this.nodeType === 'dummy') {
        return new DummyApi(this);
      }

      if (!this.apiUrl || !this.tokenId || !this.secret) {
        throw new Error(`Node ${this.name}: Missing Proxmox configuration (apiUrl, tokenId, and secret are required)`);
      }

      const httpsAgent = new https.Agent({
        rejectUnauthorized: this.tlsVerify !== false
      });

      const isApiToken = this.tokenId.includes('!');

      if (isApiToken) {
        // API token authentication - pass directly to constructor
        return new ProxmoxApi(this.apiUrl, this.tokenId, this.secret, { httpsAgent });
      }

      // Username/password authentication - authenticate and return client
      const client = new ProxmoxApi(this.apiUrl, null, null, { httpsAgent });
      try {
        await client.authenticate(this.tokenId, this.secret);
        return client;
      } catch (error) {
        throw new Error(`Node ${this.name}: Authentication failed - ${error.message}`);
      }
    }
  }
  Node.init({
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    nodeType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'proxmox'
    },
    ipv4Address: {
      type: DataTypes.STRING(15),
      allowNull: true
    },
    apiUrl: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    tokenId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    secret: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    tlsVerify: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    },
    imageStorage: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'local'
    },
    volumeStorage: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'local-lvm'
    },
    networkBridge: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'vmbr0'
    },
    nvidiaAvailable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  }, {
    sequelize,
    modelName: 'Node',
  });
  return Node;
};