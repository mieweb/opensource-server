'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Add 'dns' to Service type enum
    await queryInterface.changeColumn('Services', 'type', {
      type: Sequelize.ENUM('http', 'transport', 'dns'),
      allowNull: false
    });

    // Create DnsServices table
    await queryInterface.createTable('DnsServices', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      serviceId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'Services',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      recordType: {
        type: Sequelize.ENUM('SRV'),
        allowNull: false,
        defaultValue: 'SRV'
      },
      dnsName: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
  },

  async down (queryInterface, Sequelize) {
    // Drop DnsServices table
    await queryInterface.dropTable('DnsServices');

    // Remove 'dns' from Service type enum
    await queryInterface.changeColumn('Services', 'type', {
      type: Sequelize.ENUM('http', 'transport'),
      allowNull: false
    });
  }
};
