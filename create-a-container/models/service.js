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
    }
  }, {
    sequelize,
    modelName: 'Service'
  });
  return Service;
};
