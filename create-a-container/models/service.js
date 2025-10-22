"use strict";
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Service extends Model {
    static associate(models) {
      Service.belongsTo(models.Container, { foreignKey: 'containerId' });
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
    },
    externalPort: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true  // NULL for http services
    },
    tls: {
      type: DataTypes.BOOLEAN,
      allowNull: true  // only used for tcp services
    },
    externalHostname: {
      type: DataTypes.STRING(255),
      allowNull: true  // only used for http services
    },
  }, {
    sequelize,
    modelName: 'Service',
  });
  return Service;
};
