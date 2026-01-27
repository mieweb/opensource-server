'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Container extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // a container has many services
      Container.hasMany(models.Service, { foreignKey: 'containerId', as: 'services' });
      // a container belongs to a node
      Container.belongsTo(models.Node, { foreignKey: 'nodeId', as: 'node' });
      // a container may have a creation job
      Container.belongsTo(models.Job, { foreignKey: 'creationJobId', as: 'creationJob' });
    }

    /**
     * Build LXC config object for environment variables and entrypoint
     * Returns config suitable for Proxmox API updateLxcConfig
     * @returns {object} Config object with 'env' and 'entrypoint' properties
     */
    buildLxcEnvConfig() {
      const config = {};
      
      // Parse environment variables from JSON and format as NUL-separated list
      // Format: KEY1=value1\0KEY2=value2\0KEY3=value3
      if (this.environmentVars) {
        try {
          const envObj = JSON.parse(this.environmentVars);
          const envPairs = [];
          for (const [key, value] of Object.entries(envObj)) {
            if (key && value !== undefined) {
              envPairs.push(`${key}=${value}`);
            }
          }
          if (envPairs.length > 0) {
            config['env'] = envPairs.join('\0');
          }
        } catch (err) {
          console.error('Failed to parse environment variables JSON:', err.message);
        }
      }
      
      // Set entrypoint command
      if (this.entrypoint && this.entrypoint.trim()) {
        config['entrypoint'] = this.entrypoint.trim();
      }
      
      return config;
    }
  }
  Container.init({
    hostname: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    username: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending'
    },
    template: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    creationJobId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Jobs',
        key: 'id'
      }
    },
    nodeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Nodes',
        key: 'id'
      }
    },
    containerId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },
    macAddress: {
      type: DataTypes.STRING(17),
      allowNull: true,
      unique: true
    },
    ipv4Address: {
      type: DataTypes.STRING(45),
      allowNull: true,
      unique: true
    },
    aiContainer: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'N'
    },
    environmentVars: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null
    },
    entrypoint: {
      type: DataTypes.STRING(2000),
      allowNull: true,
      defaultValue: null
    }
  }, {
    sequelize,
    modelName: 'Container',
    indexes: [
      {
        name: 'containers_node_id_container_id_unique',
        unique: true,
        fields: ['nodeId', 'containerId']
      }
    ]
  });
  return Container;
};