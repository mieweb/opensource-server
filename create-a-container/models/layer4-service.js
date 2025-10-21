"use strict";
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Layer4Service extends Model {
    static associate(models) {
      Layer4Service.belongsTo(models.Service, { foreignKey: 'serviceId' });
    }
  }
  Layer4Service.init({
    serviceId: {
      type: DataTypes.INTEGER,
      primaryKey: true
    },
    externalPort: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    tls: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Layer4Service',
    tableName: 'Layer4Services'
  });
  return Layer4Service;
};
