'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('SessionSecrets', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      secret: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Session secret for express-session'
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add index for efficient retrieval in reverse chronological order
    await queryInterface.addIndex('SessionSecrets', ['createdAt'], {
      name: 'idx_session_secrets_created_at'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('SessionSecrets');
  }
};
