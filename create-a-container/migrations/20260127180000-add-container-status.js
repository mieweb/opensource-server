'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Containers', 'status', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'running'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Containers', 'status');
  }
};
