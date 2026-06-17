"use strict";
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TransportService extends Model {
    static associate(models) {
      TransportService.belongsTo(models.Service, { foreignKey: 'serviceId', as: 'service' });
      TransportService.belongsTo(models.ExternalDomain, { foreignKey: 'externalDomainId', as: 'externalDomain' });
    }

    // Find the next available external port for the given protocol in the specified range
    static async nextAvailablePortInRange(protocol, minPort, maxPort, transaction = null) {
      const queryOptions = {
        where: {
          protocol: protocol,
          externalPort: {
            [sequelize.Sequelize.Op.between]: [minPort, maxPort]
          }
        },
        attributes: ['externalPort'],
        order: [['externalPort', 'ASC']]
      };
      
      if (transaction) {
        queryOptions.transaction = transaction;
        queryOptions.lock = sequelize.Sequelize.Transaction.LOCK.UPDATE;
      }
      
      const usedServices = await TransportService.findAll(queryOptions);

      const usedPorts = new Set(usedServices.map(s => s.externalPort));

      for (let port = minPort; port <= maxPort; port++) {
        if (!usedPorts.has(port)) {
          return port;
        }
      }

      throw new Error(`No available ports in range ${minPort}-${maxPort} for protocol ${protocol}`);
    }
  }

  TransportService.init({
    serviceId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: {
        model: 'Services',
        key: 'id'
      }
    },
    protocol: {
      type: DataTypes.ENUM('tcp', 'udp'),
      allowNull: false,
      validate: {
        isIn: [['tcp', 'udp']]
      }
    },
    externalPort: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      validate: {
        min: 1,
        max: 65535
      }
    },
    tls: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'Whether to use TLS for TCP connections'
    },
    externalHostname: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        is: {
          args: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
          msg: 'Hostname must be 1–63 characters, only lowercase letters, digits, and hyphens, and must start and end with a letter or digit'
        }
      }
    },
    externalDomainId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'ExternalDomains',
        key: 'id'
      }
    }
  }, {
    sequelize,
    modelName: 'TransportService',
    validate: {
      // TLS termination is only supported for TCP (nginx stream `ssl`).
      // UDP would require DTLS, which this load balancer does not provide.
      tlsRequiresTcp() {
        if (this.tls && this.protocol !== 'tcp') {
          throw new Error('TLS can only be enabled for TCP services');
        }
      },
      // A TLS-enabled TCP service must reference an external domain so the
      // load balancer knows which certificate to terminate with.
      tlsRequiresDomain() {
        if (this.tls && !this.externalDomainId) {
          throw new Error('A TLS-enabled TCP service must have an externalDomainId');
        }
      }
    },
    indexes: [
      {
        name: 'transport_services_unique_protocol_port',
        unique: true,
        fields: ['protocol', 'externalPort']
      }
    ]
  });

  return TransportService;
};
