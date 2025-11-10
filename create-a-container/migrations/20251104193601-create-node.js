'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Nodes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      apiUrl: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      tlsVerify: {
        type: Sequelize.BOOLEAN,
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

    // Seed the Nodes table with existing node values from Containers
    await queryInterface.sequelize.query(`
      INSERT INTO Nodes (name, apiUrl, tlsVerify, createdAt, updatedAt)
      SELECT DISTINCT node, NULL, NULL, NOW(), NOW()
      FROM Containers
      ORDER BY node
    `);
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Nodes');
  }
};