'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Table for storing OIDC session data
    await queryInterface.createTable('OIDCSessions', {
      id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      uid: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      grantId: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      data: {
        type: Sequelize.TEXT('long'),
        allowNull: false
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      consumedAt: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Table for storing OIDC access tokens
    await queryInterface.createTable('OIDCAccessTokens', {
      id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      grantId: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      clientId: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      accountId: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      data: {
        type: Sequelize.TEXT('long'),
        allowNull: false
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      consumedAt: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Table for storing OIDC authorization codes
    await queryInterface.createTable('OIDCAuthorizationCodes', {
      id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      grantId: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      clientId: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      accountId: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      data: {
        type: Sequelize.TEXT('long'),
        allowNull: false
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      consumedAt: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Table for storing OIDC refresh tokens
    await queryInterface.createTable('OIDCRefreshTokens', {
      id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      grantId: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      clientId: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      accountId: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      data: {
        type: Sequelize.TEXT('long'),
        allowNull: false
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      consumedAt: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Table for storing OIDC interaction sessions
    await queryInterface.createTable('OIDCInteractions', {
      id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true
      },
      data: {
        type: Sequelize.TEXT('long'),
        allowNull: false
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false
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

    // Add indexes for performance
    await queryInterface.addIndex('OIDCSessions', ['grantId']);
    await queryInterface.addIndex('OIDCSessions', ['expiresAt']);
    await queryInterface.addIndex('OIDCAccessTokens', ['grantId']);
    await queryInterface.addIndex('OIDCAccessTokens', ['clientId']);
    await queryInterface.addIndex('OIDCAccessTokens', ['accountId']);
    await queryInterface.addIndex('OIDCAccessTokens', ['expiresAt']);
    await queryInterface.addIndex('OIDCAuthorizationCodes', ['grantId']);
    await queryInterface.addIndex('OIDCAuthorizationCodes', ['clientId']);
    await queryInterface.addIndex('OIDCAuthorizationCodes', ['accountId']);
    await queryInterface.addIndex('OIDCAuthorizationCodes', ['expiresAt']);
    await queryInterface.addIndex('OIDCRefreshTokens', ['grantId']);
    await queryInterface.addIndex('OIDCRefreshTokens', ['clientId']);
    await queryInterface.addIndex('OIDCRefreshTokens', ['accountId']);
    await queryInterface.addIndex('OIDCRefreshTokens', ['expiresAt']);
    await queryInterface.addIndex('OIDCInteractions', ['expiresAt']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('OIDCInteractions');
    await queryInterface.dropTable('OIDCRefreshTokens');
    await queryInterface.dropTable('OIDCAuthorizationCodes');
    await queryInterface.dropTable('OIDCAccessTokens');
    await queryInterface.dropTable('OIDCSessions');
  }
};
