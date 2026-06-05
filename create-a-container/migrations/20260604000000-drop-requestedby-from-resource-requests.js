'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('ResourceRequests', 'requestedBy');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('ResourceRequests', 'requestedBy', {
      type: Sequelize.STRING(255),
      allowNull: false,
      defaultValue: '',
    });
  },
};
