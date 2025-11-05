"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Services table: each service belongs to a Container
    await queryInterface.createTable('Services', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      containerId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Containers',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      type: {
        type: Sequelize.ENUM('tcp','udp','http'),
        allowNull: false
      },
      internalPort: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false
      },
      externalPort: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true  // NULL for http services
      },
      tls: {
        type: Sequelize.BOOLEAN,
        allowNull: true  // only used for tcp services
      },
      externalHostname: {
        type: Sequelize.STRING(255),
        allowNull: true  // only used for http services
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('HttpServices');
    await queryInterface.dropTable('Layer4Services');
    await queryInterface.dropTable('Services');
  }
};
