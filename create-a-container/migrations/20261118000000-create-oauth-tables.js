'use strict';

/**
 * OAuth 2.1 authorization server storage (issue #512).
 *
 * One table for everything oidc-provider persists through its adapter
 * (resources/oauth/adapter.js): clients, grants, access/refresh tokens,
 * authorization codes, interactions and its internal sessions. `payload` is
 * the provider's opaque JSON; the other columns are extracted from it so the
 * adapter, the "Authorized apps" page and the sweep can query them.
 *
 * Token-like records are keyed by a SHA-256 of the token value, never the
 * value itself; client secrets are stored hashed too.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OAuthPayloads', {
      // oidc-provider model name: Client, Grant, AccessToken, RefreshToken,
      // AuthorizationCode, ClientCredentials, Interaction, Session, ...
      model: { type: Sequelize.STRING(64), allowNull: false, primaryKey: true },
      // Record id (SHA-256 hex for token-like models).
      id: { type: Sequelize.STRING(2048), allowNull: false, primaryKey: true },
      payload: { type: Sequelize.JSON, allowNull: false },
      grantId: { type: Sequelize.STRING(255), allowNull: true },
      uid: { type: Sequelize.STRING(255), allowNull: true },
      // Manager username the record acts for (Grant, tokens).
      accountId: { type: Sequelize.STRING(255), allowNull: true },
      clientId: { type: Sequelize.STRING(2048), allowNull: true },
      // App-side data the provider doesn't own (client display info on grants).
      meta: { type: Sequelize.JSON, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      consumedAt: { type: Sequelize.DATE, allowNull: true },
      lastUsedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('OAuthPayloads', ['grantId'], { name: 'oauth_payloads_grant_id' });
    await queryInterface.addIndex('OAuthPayloads', ['model', 'uid'], { name: 'oauth_payloads_model_uid' });
    await queryInterface.addIndex('OAuthPayloads', ['model', 'accountId'], { name: 'oauth_payloads_model_account' });
    await queryInterface.addIndex('OAuthPayloads', ['clientId'], { name: 'oauth_payloads_client_id' });
    await queryInterface.addIndex('OAuthPayloads', ['expiresAt'], { name: 'oauth_payloads_expires_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('OAuthPayloads');
  },
};
