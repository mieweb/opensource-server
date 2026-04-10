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
        is: {
          args: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
          msg: 'Hostname must be 1–63 characters, only lowercase letters, digits, and hyphens, and must start and end with a letter or digit'
        }
      }
    },
    externalDomainId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'ExternalDomains',
        key: 'id'
      }
    },
    backendProtocol: {
      type: DataTypes.ENUM('http', 'https'),
      allowNull: false,
      defaultValue: 'http'
    },
    authRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
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
