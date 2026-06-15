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
      // a container belongs to a site
      Container.belongsTo(models.Site, { foreignKey: 'siteId', as: 'site' });
      // a container may have a creation job
      Container.belongsTo(models.Job, { foreignKey: 'creationJobId', as: 'creationJob' });
    }

    /**
     * Load the admin-defined system default environment variables from the
     * Settings table, flattened to a { KEY: value } object. Descriptions are
     * metadata only and are not included. Returns an empty object if the
     * setting is missing or malformed.
     * @returns {Promise<object>} Flat object of { KEY: value } system defaults
     */
    static async getSystemDefaultEnvVars() {
      const Setting = this.sequelize.models.Setting;
      const defaults = {};
      try {
        const entries = await Setting.getDefaultContainerEnvVars();
        for (const entry of entries) {
          if (entry.key && entry.key.trim()) {
            defaults[entry.key.trim()] = entry.value || '';
          }
        }
      } catch (_) {
        console.warn('Could not load default_container_env_vars from settings, skipping');
      }
      return defaults;
    }

    /**
     * Parse the container's user-defined environment variables.
     * The database record only ever stores the variables the user explicitly
     * provided — admin/system, image, and NVIDIA defaults are merged in at
     * configure-time (see buildLxcEnvConfig) and are intentionally NOT persisted.
     * @returns {object} Flat object of { KEY: value } user-defined env vars
     */
    parseEnvironmentVars() {
      if (!this.environmentVars) return {};
      try {
        const parsed = JSON.parse(this.environmentVars);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (err) {
        console.error('Failed to parse environment variables JSON:', err.message);
        return {};
      }
    }

    /**
     * Environment variables implied by this container's configuration that are
     * applied as defaults but never stored in the DB record. Currently this is
     * the NVIDIA GPU passthrough defaults, applied when nvidiaRequested is set.
     * @returns {object} Flat object of { KEY: value } defaults
     */
    nvidiaDefaultEnvVars() {
      if (!this.nvidiaRequested) return {};
      return {
        NVIDIA_VISIBLE_DEVICES: 'all',
        NVIDIA_DRIVER_CAPABILITIES: 'utility compute'
      };
    }

    /**
     * Build LXC config object for environment variables and entrypoint.
     * Returns config suitable for Proxmox API updateLxcConfig.
     *
     * Default environment variables are merged in here, at configure-time,
     * rather than being baked into the container's DB record. User-defined
     * variables take precedence over any provided defaults.
     *
     * @param {object} [defaults={}] - Flat object of default env vars, e.g. the
     *   admin-defined system defaults. User-defined values and this container's
     *   own NVIDIA defaults override these.
     * @returns {object} Config object with 'env' and 'entrypoint' properties
     */
    buildLxcEnvConfig(defaults = {}) {
      const config = {};
      const deleteList = [];

      // Merge precedence (lowest to highest):
      //   provided defaults (admin-defined system defaults) < NVIDIA defaults
      //   < user-defined values
      const userEnvVars = this.parseEnvironmentVars();
      const mergedEnvVars = {
        ...(defaults && typeof defaults === 'object' ? defaults : {}),
        ...this.nvidiaDefaultEnvVars(),
        ...userEnvVars
      };

      // Format as NUL-separated list: KEY1=value1\0KEY2=value2\0KEY3=value3
      const envPairs = [];
      for (const [key, value] of Object.entries(mergedEnvVars)) {
        if (key && value !== undefined) {
          envPairs.push(`${key}=${value}`);
        }
      }
      if (envPairs.length > 0) {
        config['env'] = envPairs.join('\0');
      } else {
        deleteList.push('env');
      }

      // Set entrypoint command
      if (this.entrypoint && this.entrypoint.trim()) {
        config['entrypoint'] = this.entrypoint.trim();
      } else {
        deleteList.push('entrypoint');
      }
      
      // Add delete parameter if there are options to remove
      if (deleteList.length > 0) {
        config['delete'] = deleteList.join(',');
      }
      
      return config;
    }
  }
  Container.init({
    hostname: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        is: {
          args: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
          msg: 'Hostname must be 1–63 characters, only lowercase letters, digits, and hyphens, and must start and end with a letter or digit'
        }
      }
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
    siteId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Sites',
        key: 'id'
      }
    },
    containerId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },
    macAddress: {
      type: DataTypes.STRING(17),
      allowNull: true
    },
    ipv4Address: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    aiContainer: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'N'
    },
    nvidiaRequested: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
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
        name: 'containers_node_container_id_unique',
        unique: true,
        fields: ['nodeId', 'containerId']
      },
      {
        name: 'containers_site_hostname_unique',
        unique: true,
        fields: ['siteId', 'hostname']
      },
      {
        name: 'containers_site_ipv4_unique',
        unique: true,
        fields: ['siteId', 'ipv4Address']
      },
      {
        name: 'containers_site_mac_unique',
        unique: true,
        fields: ['siteId', 'macAddress']
      }
    ]
  });
  return Container;
};