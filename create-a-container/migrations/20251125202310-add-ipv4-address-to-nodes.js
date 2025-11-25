'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'ipv4Address', {
      type: Sequelize.STRING(15),
      allowNull: true,
      after: 'name'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Nodes', 'ipv4Address');
  }
};
