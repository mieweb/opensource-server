"use strict";
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Service extends Model {
    static associate(models) {
      Service.belongsTo(models.Container, { foreignKey: 'containerId' });
      Service.hasOne(models.HTTPService, { foreignKey: 'serviceId', as: 'httpService' });
      Service.hasOne(models.TransportService, { foreignKey: 'serviceId', as: 'transportService' });
      Service.hasOne(models.DnsService, { foreignKey: 'serviceId', as: 'dnsService' });
    }
  }
  Service.init({
    containerId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('http', 'transport', 'dns'),
      allowNull: false
    },
    internalPort: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    // Stamped by POST /api/v1/services/:id/last-access when the site proxy
    // reports traffic (at most once per 10 minutes per service).
    lastAccessedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Service'
  });
  return Service;
};
