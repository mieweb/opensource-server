'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Jobs', 'serialGroup', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.addIndex('Jobs', ['serialGroup', 'status'], {
      name: 'jobs_serial_group_status_idx'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('Jobs', 'jobs_serial_group_status_idx');
    await queryInterface.removeColumn('Jobs', 'serialGroup');
  }
};
