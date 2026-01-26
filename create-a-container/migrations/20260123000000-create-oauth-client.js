'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OAuthClients', {
      clientId: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      clientSecret: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      clientName: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      redirectUris: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'JSON array of redirect URIs'
      },
      grantTypes: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '["authorization_code","refresh_token"]',
        comment: 'JSON array of grant types'
      },
      responseTypes: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '["code"]',
        comment: 'JSON array of response types'
      },
      scopes: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '["openid","profile","email","groups"]',
        comment: 'JSON array of allowed scopes'
      },
      ownerUidNumber: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'uidNumber'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // Add index on ownerUidNumber for faster queries
    await queryInterface.addIndex('OAuthClients', ['ownerUidNumber']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('OAuthClients');
  }
};
