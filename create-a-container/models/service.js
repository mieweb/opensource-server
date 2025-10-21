"use strict";
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Service extends Model {
    static associate(models) {
      Service.belongsTo(models.Container, { foreignKey: 'containerId' });
      Service.hasOne(models.Layer4Service, { foreignKey: 'serviceId', as: 'layer4Info' });
      Service.hasOne(models.HttpService, { foreignKey: 'serviceId', as: 'httpInfo' });
    }
  }
  Service.init({
    containerId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('tcp','udp','http'),
      allowNull: false
    },
    internalPort: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'Service',
  });
  return Service;
};
