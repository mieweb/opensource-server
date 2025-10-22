'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Containers', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      hostname: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      username: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      osRelease: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      containerId: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true
      },
      macAddress: {
        type: Sequelize.STRING(17),
        allowNull: false,
        unique: true
      },
      ipv4Address: {
        type: Sequelize.STRING(45),
        allowNull: false,
        unique: true
      },
      aiContainer: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      publicKey: {
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
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Containers');
  }
};