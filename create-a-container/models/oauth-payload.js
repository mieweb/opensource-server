'use strict';
const { Model } = require('sequelize');

/**
 * A record persisted by oidc-provider through resources/oauth/adapter.js.
 * See the migration for the column meanings.
 */
module.exports = (sequelize, DataTypes) => {
  class OAuthPayload extends Model {}

  OAuthPayload.init({
    model: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id: { type: DataTypes.STRING(2048), allowNull: false, primaryKey: true },
    payload: { type: DataTypes.JSON, allowNull: false },
    grantId: { type: DataTypes.STRING(255), allowNull: true },
    uid: { type: DataTypes.STRING(255), allowNull: true },
    accountId: { type: DataTypes.STRING(255), allowNull: true },
    clientId: { type: DataTypes.STRING(2048), allowNull: true },
    meta: { type: DataTypes.JSON, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    consumedAt: { type: DataTypes.DATE, allowNull: true },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    sequelize,
    modelName: 'OAuthPayload',
    tableName: 'OAuthPayloads',
    timestamps: true,
    indexes: [
      { fields: ['grantId'] },
      { fields: ['model', 'uid'] },
      { fields: ['model', 'accountId'] },
      { fields: ['clientId'] },
      { fields: ['expiresAt'] },
    ],
  });

  return OAuthPayload;
};
