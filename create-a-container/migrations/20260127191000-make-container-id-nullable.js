'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Containers', 'containerId', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Containers', 'containerId', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false
    });
  }
};
