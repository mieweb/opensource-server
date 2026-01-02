"use strict";
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class HTTPService extends Model {
    static associate(models) {
      HTTPService.belongsTo(models.Service, { foreignKey: 'serviceId', as: 'service' });
      HTTPService.belongsTo(models.ExternalDomain, { foreignKey: 'externalDomainId', as: 'externalDomain' });
    }
  }

  HTTPService.init({
    serviceId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: {
        model: 'Services',
        key: 'id'
      }
    },
    externalHostname: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    externalDomainId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'ExternalDomains',
        key: 'id'
      }
    }
  }, {
    sequelize,
    modelName: 'HTTPService',
    indexes: [
      {
        name: 'http_services_unique_hostname_domain',
        unique: true,
        fields: ['externalHostname', 'externalDomainId']
      }
    ]
  });

  return HTTPService;
};
