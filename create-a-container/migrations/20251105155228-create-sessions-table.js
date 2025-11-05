'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('Sessions', {
      session_id: {
        type: Sequelize.STRING(32),
        primaryKey: true,
        allowNull: false
      },
      expires: {
        type: Sequelize.DATE,
        allowNull: true
      },
      data: {
        type: Sequelize.TEXT,
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
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('Sessions');
  }
};
