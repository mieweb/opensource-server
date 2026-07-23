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
