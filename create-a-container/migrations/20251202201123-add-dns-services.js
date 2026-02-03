'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Add 'dns' to Service type enum
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === 'postgres') {
      // Rename the existing enum
      await queryInterface.sequelize.query('ALTER TYPE "enum_Services_type" RENAME TO "enum_Services_type_old"');
      
      // Create new enum with dns added
      await queryInterface.sequelize.query("CREATE TYPE \"enum_Services_type\" AS ENUM ('http', 'transport', 'dns')");
      
      // Update the column to use the new enum
      await queryInterface.sequelize.query('ALTER TABLE "Services" ALTER COLUMN "type" TYPE "enum_Services_type" USING "type"::text::"enum_Services_type"');
      
      // Drop old enum
      await queryInterface.sequelize.query('DROP TYPE "enum_Services_type_old"');
    } else {
      // SQLite and other databases
      await queryInterface.changeColumn('Services', 'type', {
        type: Sequelize.ENUM('http', 'transport', 'dns'),
        allowNull: false
      });
    }

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
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === 'postgres') {
      // Rename the existing enum
      await queryInterface.sequelize.query('ALTER TYPE "enum_Services_type" RENAME TO "enum_Services_type_old"');
      
      // Create new enum without dns
      await queryInterface.sequelize.query("CREATE TYPE \"enum_Services_type\" AS ENUM ('http', 'transport')");
      
      // Update the column to use the new enum
      await queryInterface.sequelize.query('ALTER TABLE "Services" ALTER COLUMN "type" TYPE "enum_Services_type" USING "type"::text::"enum_Services_type"');
      
      // Drop old enum
      await queryInterface.sequelize.query('DROP TYPE "enum_Services_type_old"');
    } else {
      // SQLite and other databases
      await queryInterface.changeColumn('Services', 'type', {
        type: Sequelize.ENUM('http', 'transport'),
        allowNull: false
      });
    }
  }
};
