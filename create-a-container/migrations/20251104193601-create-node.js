'use strict';

const { sequelize } = require('../models');

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
    const containersTable = queryInterface.quoteIdentifier('Containers');
    const [nodeNames, _] = await queryInterface.sequelize.query(
      `SELECT DISTINCT node FROM ${containersTable}`
    );
    const nodes = nodeNames.map(n => ({ name: n.node, createdAt: new Date(), updatedAt: new Date() }));
    if (nodes.length > 0) {
      await queryInterface.bulkInsert('Nodes', nodes);
    }
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Nodes');
  }
};