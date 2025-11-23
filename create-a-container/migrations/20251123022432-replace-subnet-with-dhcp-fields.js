'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Remove subnet column
    await queryInterface.removeColumn('Sites', 'subnet');
    
    // Add dhcpRange and subnetMask columns
    await queryInterface.addColumn('Sites', 'dhcpRange', {
      type: Sequelize.STRING,
      allowNull: true
    });
    
    await queryInterface.addColumn('Sites', 'subnetMask', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down (queryInterface, Sequelize) {
    // Remove dhcpRange and subnetMask columns
    await queryInterface.removeColumn('Sites', 'dhcpRange');
    await queryInterface.removeColumn('Sites', 'subnetMask');
    
    // Restore subnet column
    await queryInterface.addColumn('Sites', 'subnet', {
      type: Sequelize.STRING,
      allowNull: true
    });
  }
};
