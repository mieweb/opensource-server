'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Sites', 'externalIp', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Public IP address used as the target for Cloudflare DNS A records'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Sites', 'externalIp');
  }
};
