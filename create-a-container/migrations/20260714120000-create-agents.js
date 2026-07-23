'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Agents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      siteId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Sites', key: 'id' },
        onDelete: 'CASCADE'
      },
      hostname: {
        type: Sequelize.STRING,
        allowNull: false
      },
      ipv4Address: {
        type: Sequelize.STRING,
        allowNull: true
      },
      services: {
        type: Sequelize.JSON,
        allowNull: true
      },
      lastCheckinAt: {
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
    await queryInterface.addIndex('Agents', ['siteId', 'hostname'], {
      unique: true,
      name: 'agents_site_id_hostname_unique'
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('Agents');
  }
};
