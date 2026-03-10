'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Containers', 'oneShotCommands', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
      comment: 'JSON array of bash commands to run once inside the container after creation'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Containers', 'oneShotCommands');
  }
};
