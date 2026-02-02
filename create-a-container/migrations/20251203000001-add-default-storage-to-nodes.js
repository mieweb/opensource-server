'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'defaultStorage', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Default storage target for container templates and images'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Nodes', 'defaultStorage');
  }
};
