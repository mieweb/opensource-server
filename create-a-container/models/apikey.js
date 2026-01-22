'use strict';
const {
  Model
} = require('sequelize');
const argon2 = require('argon2');

module.exports = (sequelize, DataTypes) => {
  class ApiKey extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      ApiKey.belongsTo(models.User, {
        foreignKey: 'uidNumber',
        as: 'user'
      });
    }

    /**
     * Validates a plaintext API key against the stored encrypted key
     * @param {string} plainKey - The plaintext API key to validate
     * @returns {boolean} - True if the key matches, false otherwise
     */
    async validateKey(plainKey) {
      return await argon2.verify(this.keyHash, plainKey);
    }

    /**
     * Updates the lastUsedAt timestamp
     */
    async recordUsage() {
      this.lastUsedAt = new Date();
      await this.save({ fields: ['lastUsedAt'] });
    }
  }

  ApiKey.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    uidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'uidNumber'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    keyPrefix: {
      type: DataTypes.STRING(8),
      allowNull: false,
      comment: 'First 8 characters of the API key for identification'
    },
    keyHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Argon2 hash of the full API key'
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'User-provided description of the API key purpose'
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp of when this key was last used'
    }
  }, {
    sequelize,
    modelName: 'ApiKey',
    tableName: 'ApiKeys',
    timestamps: true,
    indexes: [
      {
        fields: ['uidNumber']
      },
      {
        fields: ['keyPrefix']
      }
    ],
    hooks: {
      beforeCreate: async (apiKey, options) => {
        if (!apiKey.keyHash) {
          throw new Error('keyHash must be provided before creating an API key');
        }
        if (!apiKey.keyPrefix) {
          throw new Error('keyPrefix must be provided before creating an API key');
        }
      }
    }
  });

  return ApiKey;
};
