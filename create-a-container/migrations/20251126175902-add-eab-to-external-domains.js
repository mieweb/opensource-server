'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('ExternalDomains', 'eabKid', {
      type: Sequelize.STRING(255),
      allowNull: true,
      after: 'cloudflareApiKey'
    });
    
    await queryInterface.addColumn('ExternalDomains', 'eabHmac', {
      type: Sequelize.STRING(255),
      allowNull: true,
      after: 'eabKid'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('ExternalDomains', 'eabKid');
    await queryInterface.removeColumn('ExternalDomains', 'eabHmac');
  }
};
