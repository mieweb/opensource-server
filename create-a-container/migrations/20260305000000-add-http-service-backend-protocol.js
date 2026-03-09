'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('HTTPServices', 'backendProtocol', {
      type: Sequelize.ENUM('http', 'https'),
      allowNull: false,
      defaultValue: 'http'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('HTTPServices', 'backendProtocol');

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_HTTPServices_backendProtocol"');
    }
  }
};
