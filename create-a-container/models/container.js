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
     * Normalize a set of environment variables into a safe, flat
     * { KEY: stringValue } object suitable for building the Proxmox `env`
     * string. This is the single place that decides what a valid env var is.
     *
     * Rules (applied to every source — user input, settings, image defaults):
     *  - Input that is not a plain object (e.g. an array or null) yields {}.
     *  - Keys are trimmed. A key is dropped unless it is a non-empty string with
     *    no whitespace and no `=` or NUL — i.e. it matches a conventional env
     *    var name. This prevents a key from corrupting the NUL-separated
     *    `KEY=value` encoding.
     *  - Values are coerced to strings. Entries whose value is null/undefined or
     *    a non-primitive (object/array) are dropped rather than stringified to
     *    something like "[object Object]". Values containing NUL are also
     *    dropped, since NUL is the pair separator.
     *
     * @param {*} input - Candidate env vars, ideally a { key: value } object
     * @returns {object} Flat object of validated { KEY: stringValue }
     */
    static normalizeEnvVars(input) {
      const out = {};
      if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

      // Conventional env var name: starts with a letter or underscore, followed
      // by letters, digits, or underscores. Excludes `=`, NUL, whitespace, etc.
      const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/;

      for (const [rawKey, rawValue] of Object.entries(input)) {
        const key = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (!validKey.test(key)) continue;

        // Only primitives (string/number/boolean) become values; skip
        // null/undefined and objects/arrays.
        if (rawValue === null || rawValue === undefined) continue;
        if (typeof rawValue === 'object') continue;
        const value = String(rawValue);
        if (value.includes('\0')) continue;

        out[key] = value;
      }
      return out;
    }

    /**
     * Internal helper for buildLxcEnvConfig.
     * Load the admin-defined system default environment variables from the
     * Settings table, flattened to a validated { KEY: value } object.
     * Descriptions are metadata only and are not included. Returns an empty
     * object if the setting is missing or malformed.
     * @returns {Promise<object>} Flat object of { KEY: value } system defaults
     */
    static async getSystemDefaultEnvVars() {
      const Setting = this.sequelize.models.Setting;
      const raw = {};
      try {
        const entries = await Setting.getDefaultContainerEnvVars();
        for (const entry of entries) {
          // getDefaultContainerEnvVars yields { key, value, description }.
          if (entry && typeof entry.key === 'string') {
            raw[entry.key] = entry.value;
          }
        }
      } catch (_) {
        console.warn('Could not load default_container_env_vars from settings, skipping');
      }
      return this.normalizeEnvVars(raw);
    }

    /**
     * Internal helper for buildLxcEnvConfig.
     * Parse the container's user-defined environment variables into a validated,
     * flat { KEY: value } object. The database record only ever stores the
     * variables the user explicitly provided — admin/system, image, and NVIDIA
     * defaults are merged in at configure-time (see buildLxcEnvConfig) and are
     * intentionally NOT persisted.
     * @returns {object} Flat object of validated { KEY: value } user env vars
     */
    parseEnvironmentVars() {
      if (!this.environmentVars) return {};
      try {
        return this.constructor.normalizeEnvVars(JSON.parse(this.environmentVars));
      } catch (err) {
        console.error('Failed to parse environment variables JSON:', err.message);
        return {};
      }
    }

    /**
     * Internal helper for buildLxcEnvConfig.
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
     * Build the LXC config object for environment variables and entrypoint to
     * deploy to Proxmox via updateLxcConfig.
     *
     * This is the single entrypoint for determining a container's effective
     * environment. It owns the full merge of every env-var source, applied here
     * at configure-time rather than being baked into the container's DB record:
     *
     *   admin-defined system defaults < NVIDIA defaults < user-defined values
     *
     * (Image-provided defaults are submitted by the UI as user-defined values,
     * so they arrive via parseEnvironmentVars and need no special handling.)
     *
     * Proxmox's config endpoint is a partial update: keys present in the body are
     * set, omitted keys are left untouched, and a key is only removed if named in
     * the special `delete` parameter. That distinction matters here:
     *
     *  - On create, the container has just been cloned from a template that may
     *    carry its own `env`/`entrypoint`. We must NOT delete those when the user
     *    didn't provide a value, or we'd wipe the template's defaults. So the
     *    default (deleteMissing=false) simply omits anything with no value.
     *  - On reconfigure, the user may have cleared their last env var or removed a
     *    custom entrypoint, and that change must take effect — so the caller
     *    passes deleteMissing=true to emit `delete` for the now-empty fields.
     *
     * @param {object} [options]
     * @param {boolean} [options.deleteMissing=false] - When true, env/entrypoint
     *   that resolve to empty are added to Proxmox's `delete` list (removing any
     *   existing value). When false, they are simply omitted, preserving whatever
     *   the container/template already has.
     * @returns {Promise<object>} Config object with 'env' and 'entrypoint'
     *   properties (and, when deleteMissing is set, a 'delete' list)
     */
    async buildLxcEnvConfig({ deleteMissing = false } = {}) {
      const config = {};
      const deleteList = [];

      // Merge precedence (lowest to highest):
      //   system defaults < NVIDIA defaults < user-defined values
      // Every source is already normalized to a safe { KEY: stringValue } map
      // (see normalizeEnvVars), so the encoding below cannot be corrupted.
      const mergedEnvVars = {
        ...(await this.constructor.getSystemDefaultEnvVars()),
        ...this.nvidiaDefaultEnvVars(),
        ...this.parseEnvironmentVars()
      };

      // Format as NUL-separated list: KEY1=value1\0KEY2=value2\0KEY3=value3
      const envPairs = [];
      for (const [key, value] of Object.entries(mergedEnvVars)) {
        envPairs.push(`${key}=${value}`);
      }
      if (envPairs.length > 0) {
        config['env'] = envPairs.join('\0');
      } else if (deleteMissing) {
        deleteList.push('env');
      }

      // Set entrypoint command
      if (this.entrypoint && this.entrypoint.trim()) {
        config['entrypoint'] = this.entrypoint.trim();
      } else if (deleteMissing) {
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