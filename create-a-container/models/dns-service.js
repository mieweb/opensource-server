"use strict";
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DnsService extends Model {
    static associate(models) {
      DnsService.belongsTo(models.Service, { foreignKey: 'serviceId', as: 'service' });
    }
  }

  DnsService.init({
    serviceId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: {
        model: 'Services',
        key: 'id'
      }
    },
    recordType: {
      type: DataTypes.ENUM('SRV'),
      allowNull: false,
      defaultValue: 'SRV'
    },
    dnsName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: true
      }
    }
  }, {
    sequelize,
    modelName: 'DnsService'
  });

  return DnsService;
};
