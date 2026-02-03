'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'imageStorage', {
      type: Sequelize.STRING(255),
      allowNull: false,
      defaultValue: 'local'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Nodes', 'imageStorage');
  }
};
