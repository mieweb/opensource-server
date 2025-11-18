"use strict";
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Service extends Model {
    static associate(models) {
      Service.belongsTo(models.Container, { foreignKey: 'containerId' });
    }

    // finds the next available external port for the given type in the specified range
    static async nextAvailablePortInRange(type, minPort, maxPort) {
      // Get all used ports for this type
      const usedServices = await Service.findAll({
        where: {
          type: type,
          externalPort: {
            [sequelize.Sequelize.Op.between]: [minPort, maxPort]
          }
        },
        attributes: ['externalPort'],
        order: [['externalPort', 'ASC']]
      });

      const usedPorts = new Set(usedServices.map(s => s.externalPort));

      // Find the first available port in the range
      for (let port = minPort; port <= maxPort; port++) {
        if (!usedPorts.has(port)) {
          return port;
        }
      }

      // No available ports in range
      throw new Error(`No available ports in range ${minPort}-${maxPort} for type ${type}`);
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
    indexes: [
      {
        name: 'services_http_unique_hostname',
        unique: true,
        fields: ['externalHostname']
      },
      {
        name: 'services_layer4_unique_port',
        unique: true,
        fields: ['type', 'externalPort']
      }
    ]
  });
  return Service;
};
