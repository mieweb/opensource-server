"use strict";
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class HttpService extends Model {
    static associate(models) {
      HttpService.belongsTo(models.Service, { foreignKey: 'serviceId' });
    }
  }
  HttpService.init({
    serviceId: {
      type: DataTypes.INTEGER,
      primaryKey: true
    },
    externalHostname: {
      type: DataTypes.STRING(255),
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'HttpService',
    tableName: 'HttpServices'
  });
  return HttpService;
};
