'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'tokenId', {
      type: Sequelize.STRING(255),
      allowNull: true,
      after: 'apiUrl'
    });
    
    await queryInterface.addColumn('Nodes', 'secret', {
      type: Sequelize.STRING(255),
      allowNull: true,
      after: 'tokenId'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Nodes', 'tokenId');
    await queryInterface.removeColumn('Nodes', 'secret');
  }
};
