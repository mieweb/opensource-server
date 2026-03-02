'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'volumeStorage', {
      type: Sequelize.STRING(255),
      allowNull: false,
      defaultValue: 'local-lvm'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Nodes', 'volumeStorage');
  }
};
