'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Setting extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // No associations for now
    }

    /**
     * Gets a setting value by key
     * @param {string} key - The setting key
     * @returns {Promise<string|null>} - The setting value or null if not found
     */
    static async get(key) {
      const setting = await Setting.findByPk(key);
      return setting ? setting.value : null;
    }

    /**
     * Sets a setting value
     * @param {string} key - The setting key
     * @param {string} value - The setting value
     * @returns {Promise<Setting>} - The created or updated setting
     */
    static async set(key, value) {
      const [setting] = await Setting.upsert({ key, value });
      return setting;
    }

    /**
     * Gets multiple settings by keys
     * @param {string[]} keys - Array of setting keys
     * @returns {Promise<Object>} - Object with keys and their values
     */
    static async getMultiple(keys) {
      const settings = await Setting.findAll({
        where: {
          key: keys
        }
      });
      return settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});
    }

    /**
     * Returns the default_container_env_vars setting as an array of
     * {key, value, description} objects. Handles both the current array
     * format and the legacy flat-object format {KEY: value}.
     * @returns {Promise<Array<{key: string, value: string, description: string}>>}
     */
    static async getDefaultContainerEnvVars() {
      const json = await Setting.get('default_container_env_vars');
      if (!json) return [];
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed).map(([key, value]) => ({ key, value, description: '' }));
      }
      return [];
    }
  }

  Setting.init({
    key: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false,
      unique: true
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'Setting',
    tableName: 'Settings',
    timestamps: true
  });

  return Setting;
};
