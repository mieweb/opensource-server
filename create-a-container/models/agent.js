'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Agent extends Model {
    static associate(models) {
      Agent.belongsTo(models.Site, {
        foreignKey: 'siteId',
        as: 'site'
      });
    }
  }
  Agent.init({
    siteId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    hostname: {
      type: DataTypes.STRING,
      allowNull: false
    },
    ipv4Address: {
      type: DataTypes.STRING,
      allowNull: true
    },
    services: {
      // Per-service status as reported by the agent at check-in:
      // { nginx: { state: 'active', lastApply: 'success' }, ... }
      type: DataTypes.JSON,
      allowNull: true
    },
    enabledServices: {
      // Service groups the agent is configured to run (AGENT_SERVICES),
      // e.g. ['nginx', 'dnsmasq', 'mail'].
      type: DataTypes.JSON,
      allowNull: true
    },
    missingBinaries: {
      // Binaries/SQL drivers the agent reports missing for its enabled
      // services, e.g. ['postfix', 'dovecot']. Blocks the mail-host claim.
      type: DataTypes.JSON,
      allowNull: true
    },
    mailHostSince: {
      // The mail-host claim: at most one agent holds it (partial unique
      // index on (1) WHERE mailHostSince IS NOT NULL — Postgres/SQLite).
      type: DataTypes.DATE,
      allowNull: true
    },
    isLocal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    apiKeyId: {
      // Pinned on the first remote check-in; later remote check-ins must
      // present the same key. Cleared via DELETE /agents/:id/api-key-pin.
      type: DataTypes.UUID,
      allowNull: true
    },
    lastCheckinAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Agent',
    indexes: [
      { unique: true, fields: ['siteId', 'hostname'] }
    ]
  });
  return Agent;
};
