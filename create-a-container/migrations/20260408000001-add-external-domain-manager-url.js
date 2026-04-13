'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ExternalDomains', 'authServer', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ExternalDomains', 'authServer');
  }
};
