'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'oidcSubject', {
      type: Sequelize.STRING(255),
      allowNull: true,
      unique: true
    });
    await queryInterface.addColumn('Users', 'oidcIssuer', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'oidcIssuer');
    await queryInterface.removeColumn('Users', 'oidcSubject');
  }
};
