'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Subdomain label for TLS-terminated TCP services (e.g. "db" in
    // "db.example.com"). Mirrors HTTPService.externalHostname. Nullable
    // because plaintext TCP/UDP services don't use it.
    await queryInterface.addColumn('TransportServices', 'externalHostname', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Subdomain label used for TLS-enabled TCP services (e.g. "db")'
    });

    // External domain whose certificate (/etc/ssl/certs/<domain>.crt) is used
    // to terminate TLS at the load balancer. Mirrors HTTPService.externalDomainId.
    await queryInterface.addColumn('TransportServices', 'externalDomainId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'ExternalDomains',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'External domain providing the TLS certificate for TCP TLS termination'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('TransportServices', 'externalDomainId');
    await queryInterface.removeColumn('TransportServices', 'externalHostname');
  }
};
