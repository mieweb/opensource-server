'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Remove the old unique index on externalHostname
    await queryInterface.removeIndex('Services', 'services_http_unique_hostname');

    // Add externalDomainId column
    await queryInterface.addColumn('Services', 'externalDomainId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'ExternalDomains',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'External domain for http services'
    });

    // Create new composite unique index on (externalHostname, externalDomainId)
    await queryInterface.addIndex('Services', ['externalHostname', 'externalDomainId'], {
      name: 'services_http_unique_hostname_domain',
      unique: true,
      where: {
        type: 'http'
      }
    });
  },

  async down (queryInterface, Sequelize) {
    // Remove the composite index
    await queryInterface.removeIndex('Services', 'services_http_unique_hostname_domain');

    // Remove the externalDomainId column
    await queryInterface.removeColumn('Services', 'externalDomainId');

    // Restore the old unique index on externalHostname
    await queryInterface.addIndex('Services', ['externalHostname'], {
      name: 'services_http_unique_hostname',
      unique: true
    });
  }
};
