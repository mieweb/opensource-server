'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Whether the load balancer connects to the backend over TLS (nginx
    // stream `proxy_ssl on`). This is the transport analog of an HTTPS
    // service's backendProtocol=https. Independent of the client-side `tls`
    // termination flag; a TCP service may do either or both.
    await queryInterface.addColumn('TransportServices', 'backendTls', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Whether the load balancer re-encrypts to the backend via proxy_ssl'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('TransportServices', 'backendTls');
  }
};
