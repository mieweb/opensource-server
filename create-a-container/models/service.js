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
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true  // NULL for http services
    },
    tls: {
      type: Sequelize.BOOLEAN,
      allowNull: true  // only used for tcp services
    },
    externalHostname: {
      type: Sequelize.STRING(255),
      allowNull: true  // only used for http services
    },
  }, {
    sequelize,
    modelName: 'Service',
  });
  return Service;
};
