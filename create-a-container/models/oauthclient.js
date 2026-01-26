'use strict';
const { Model } = require('sequelize');
const crypto = require('crypto');

module.exports = (sequelize, DataTypes) => {
  class OAuthClient extends Model {
    static associate(models) {
      OAuthClient.belongsTo(models.User, {
        foreignKey: 'ownerUidNumber',
        as: 'owner'
      });
    }

    /**
     * Generates a secure random client ID
     * @returns {string} - Random client ID
     */
    static generateClientId() {
      return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Generates a secure random client secret
     * @returns {string} - Random client secret
     */
    static generateClientSecret() {
      return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Gets redirect URIs as an array
     * @returns {string[]} - Array of redirect URIs
     */
    getRedirectUris() {
      return JSON.parse(this.redirectUris);
    }

    /**
     * Sets redirect URIs from an array
     * @param {string[]} uris - Array of redirect URIs
     */
    setRedirectUris(uris) {
      this.redirectUris = JSON.stringify(uris);
    }

    /**
     * Gets grant types as an array
     * @returns {string[]} - Array of grant types
     */
    getGrantTypes() {
      return JSON.parse(this.grantTypes);
    }

    /**
     * Sets grant types from an array
     * @param {string[]} types - Array of grant types
     */
    setGrantTypes(types) {
      this.grantTypes = JSON.stringify(types);
    }

    /**
     * Gets response types as an array
     * @returns {string[]} - Array of response types
     */
    getResponseTypes() {
      return JSON.parse(this.responseTypes);
    }

    /**
     * Sets response types from an array
     * @param {string[]} types - Array of response types
     */
    setResponseTypes(types) {
      this.responseTypes = JSON.stringify(types);
    }

    /**
     * Gets scopes as an array
     * @returns {string[]} - Array of scopes
     */
    getScopes() {
      return JSON.parse(this.scopes);
    }

    /**
     * Sets scopes from an array
     * @param {string[]} scopeList - Array of scopes
     */
    setScopes(scopeList) {
      this.scopes = JSON.stringify(scopeList);
    }
  }

  OAuthClient.init({
    clientId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      primaryKey: true
    },
    clientSecret: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    clientName: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    redirectUris: {
      type: DataTypes.TEXT,
      allowNull: false,
      get() {
        const rawValue = this.getDataValue('redirectUris');
        return rawValue ? JSON.parse(rawValue) : [];
      },
      set(value) {
        this.setDataValue('redirectUris', JSON.stringify(value));
      }
    },
    grantTypes: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '["authorization_code","refresh_token"]',
      get() {
        const rawValue = this.getDataValue('grantTypes');
        return rawValue ? JSON.parse(rawValue) : [];
      },
      set(value) {
        this.setDataValue('grantTypes', JSON.stringify(value));
      }
    },
    responseTypes: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '["code"]',
      get() {
        const rawValue = this.getDataValue('responseTypes');
        return rawValue ? JSON.parse(rawValue) : [];
      },
      set(value) {
        this.setDataValue('responseTypes', JSON.stringify(value));
      }
    },
    scopes: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '["openid","profile","email","groups"]',
      get() {
        const rawValue = this.getDataValue('scopes');
        return rawValue ? JSON.parse(rawValue) : [];
      },
      set(value) {
        this.setDataValue('scopes', JSON.stringify(value));
      }
    },
    ownerUidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'OAuthClient',
    tableName: 'OAuthClients',
    timestamps: true
  });

  return OAuthClient;
};
