'use strict';

/** Mail enablement + DNS verification state on external domains (issue #67). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ExternalDomains', 'mailEnabled', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await queryInterface.addColumn('ExternalDomains', 'mailDnsVerified', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await queryInterface.addColumn('ExternalDomains', 'mailMxVerified', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await queryInterface.addColumn('ExternalDomains', 'mailDnsCheckedAt', {
      type: Sequelize.DATE, allowNull: true,
    });
    await queryInterface.addColumn('ExternalDomains', 'mailDnsCheckResult', {
      type: Sequelize.JSON, allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ExternalDomains', 'mailDnsCheckResult');
    await queryInterface.removeColumn('ExternalDomains', 'mailDnsCheckedAt');
    await queryInterface.removeColumn('ExternalDomains', 'mailMxVerified');
    await queryInterface.removeColumn('ExternalDomains', 'mailDnsVerified');
    await queryInterface.removeColumn('ExternalDomains', 'mailEnabled');
  },
};
