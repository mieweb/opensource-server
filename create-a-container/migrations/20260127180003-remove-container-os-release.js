'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Containers', 'osRelease');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('Containers', 'osRelease', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  }
};
