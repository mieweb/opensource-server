'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // For HTTP services: externalHostname must be unique (NULL values are ignored by unique indexes)
    await queryInterface.addIndex('Services', ['externalHostname'], {
      name: 'services_http_unique_hostname',
      unique: true
    });

    // For TCP/UDP services: (type, externalPort) must be unique
    await queryInterface.addIndex('Services', ['type', 'externalPort'], {
      name: 'services_layer4_unique_port',
      unique: true
    });
  },

  async down (queryInterface, Sequelize) {
    // Remove unique constraints
    await queryInterface.removeIndex('Services', 'services_http_unique_hostname');
    await queryInterface.removeIndex('Services', 'services_layer4_unique_port');
  }
};
