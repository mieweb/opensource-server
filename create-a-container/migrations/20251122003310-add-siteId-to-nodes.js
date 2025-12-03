'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'siteId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Sites',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Nodes', 'siteId');
  }
};
