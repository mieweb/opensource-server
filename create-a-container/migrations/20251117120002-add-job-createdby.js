'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Jobs', 'createdBy', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addIndex('Jobs', ['createdBy']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('Jobs', ['createdBy']);
    await queryInterface.removeColumn('Jobs', 'createdBy');
  }
};
