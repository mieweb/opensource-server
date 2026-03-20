'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'networkBridge', {
      type: Sequelize.STRING(255),
      allowNull: false,
      defaultValue: 'vmbr0',
      after: 'volumeStorage'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Nodes', 'networkBridge');
  }
};
