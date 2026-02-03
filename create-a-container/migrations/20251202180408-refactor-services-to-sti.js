'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Create HTTPServices table
    await queryInterface.createTable('HTTPServices', {
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
      externalHostname: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      externalDomainId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'ExternalDomains',
          key: 'id'
        }
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

    // Create TransportServices table
    await queryInterface.createTable('TransportServices', {
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
      protocol: {
        type: Sequelize.ENUM('tcp', 'udp'),
        allowNull: false
      },
      externalPort: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false
      },
      tls: {
        type: Sequelize.BOOLEAN,
        allowNull: true
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

    // Add unique constraint for HTTPServices
    await queryInterface.addIndex('HTTPServices', ['externalHostname', 'externalDomainId'], {
      unique: true,
      name: 'http_services_unique_hostname_domain'
    });

    // Add unique constraint for TransportServices
    await queryInterface.addIndex('TransportServices', ['protocol', 'externalPort'], {
      unique: true,
      name: 'transport_services_unique_protocol_port'
    });

    // Migrate existing data from Services to HTTPServices
    const servicesTable = queryInterface.quoteIdentifier('Services');
    const [services, _] = await queryInterface.sequelize.query(`
      SELECT * FROM ${servicesTable}
    `);
    const httpServices = services.filter(s => s.type === 'http').map(s => ({
      serviceId: s.id,
      externalHostname: s.externalHostname,
      externalDomainId: s.externalDomainId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));
    // migrate existing data from Services to TransportServices
    const transportServices = services.filter(s => s.type === 'tcp' || s.type === 'udp').map(s => ({
      serviceId: s.id,
      protocol: s.type,
      externalPort: s.externalPort,
      tls: s.tls,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));

    // Remove old indexes from Services table
    await queryInterface.removeIndex('Services', 'services_http_unique_hostname_domain');
    await queryInterface.removeIndex('Services', 'services_layer4_unique_port');

    // Remove columns from Services table that are now in child tables
    await queryInterface.removeColumn('Services', 'externalPort');
    await queryInterface.removeColumn('Services', 'tls');
    await queryInterface.removeColumn('Services', 'externalHostname');
    await queryInterface.removeColumn('Services', 'externalDomainId');

    // rename tcp and udp service types to transport
    // For PostgreSQL, we need to handle ENUM modification differently
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === 'postgres') {
      // Rename the existing enum to a backup name
      await queryInterface.sequelize.query('ALTER TYPE "enum_Services_type" RENAME TO "enum_Services_type_old"');
      
      // Create new enum with transport added
      await queryInterface.sequelize.query("CREATE TYPE \"enum_Services_type\" AS ENUM ('http', 'transport', 'tcp', 'udp')");
      
      // Update the column to use the new enum
      await queryInterface.sequelize.query('ALTER TABLE "Services" ALTER COLUMN "type" TYPE "enum_Services_type" USING "type"::text::"enum_Services_type"');
      
      // Update tcp and udp to transport
      await queryInterface.bulkUpdate('Services', { type: 'transport' }, { [Sequelize.Op.or]: [ { type: 'tcp' }, { type: 'udp' } ] });
      
      // Drop old enum
      await queryInterface.sequelize.query('DROP TYPE "enum_Services_type_old"');
      
      // Rename enum again to update it to final values
      await queryInterface.sequelize.query('ALTER TYPE "enum_Services_type" RENAME TO "enum_Services_type_old"');
      
      // Create final enum with only http and transport
      await queryInterface.sequelize.query("CREATE TYPE \"enum_Services_type\" AS ENUM ('http', 'transport')");
      
      // Update the column to use the final enum
      await queryInterface.sequelize.query('ALTER TABLE "Services" ALTER COLUMN "type" TYPE "enum_Services_type" USING "type"::text::"enum_Services_type"');
      
      // Drop old enum
      await queryInterface.sequelize.query('DROP TYPE "enum_Services_type_old"');
    } else {
      // SQLite and other databases
      await queryInterface.changeColumn('Services', 'type', {
        type: Sequelize.ENUM('http', 'transport', 'tcp', 'udp'),
        allowNull: false
      });
      await queryInterface.bulkUpdate('Services', { type: 'transport' }, { [Sequelize.Op.or]: [ { type: 'tcp' }, { type: 'udp' } ] });
      await queryInterface.changeColumn('Services', 'type', {
        type: Sequelize.ENUM('http', 'transport'),
        allowNull: false
      });
    }

    // insert migrated data into new tables AFTER schema changes because of how sqlite3 handles cascades
    if (httpServices.length > 0)
      await queryInterface.bulkInsert('HTTPServices', httpServices);
    if (transportServices.length > 0)
      await queryInterface.bulkInsert('TransportServices', transportServices);
  },

  async down (queryInterface, Sequelize) {
    // Add columns back to Services table first
    await queryInterface.addColumn('Services', 'externalHostname', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    
    await queryInterface.addColumn('Services', 'externalDomainId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'ExternalDomains',
        key: 'id'
      }
    });
    
    await queryInterface.addColumn('Services', 'tls', {
      type: Sequelize.BOOLEAN,
      allowNull: true
    });
    
    await queryInterface.addColumn('Services', 'externalPort', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
    });

    // Change type enum back to include tcp and udp
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === 'postgres') {
      // Rename the existing enum
      await queryInterface.sequelize.query('ALTER TYPE "enum_Services_type" RENAME TO "enum_Services_type_old"');
      
      // Create new enum with tcp, udp, and transport
      await queryInterface.sequelize.query("CREATE TYPE \"enum_Services_type\" AS ENUM ('http', 'transport', 'tcp', 'udp')");
      
      // Update the column to use the new enum
      await queryInterface.sequelize.query('ALTER TABLE "Services" ALTER COLUMN "type" TYPE "enum_Services_type" USING "type"::text::"enum_Services_type"');
      
      // Drop old enum
      await queryInterface.sequelize.query('DROP TYPE "enum_Services_type_old"');
    } else {
      // SQLite and other databases
      await queryInterface.changeColumn('Services', 'type', {
        type: Sequelize.ENUM('http', 'transport', 'tcp', 'udp'),
        allowNull: false
      });
    }

    // Migrate data back from child tables
    const servicesTable = queryInterface.quoteIdentifier('Services');
    const httpServicesTable = queryInterface.quoteIdentifier('HTTPServices');
    const transportServicesTable = queryInterface.quoteIdentifier('TransportServices');
    
    // Restore HTTP service data
    const [httpServices, _] = await queryInterface.sequelize.query(`
      SELECT * FROM ${httpServicesTable}
    `);
    for (const hs of httpServices) {
      await queryInterface.bulkUpdate('Services', {
        externalHostname: hs.externalHostname,
        externalDomainId: hs.externalDomainId
      }, { id: hs.serviceId });
    }

    // Restore transport service data and convert type back to tcp/udp
    const [transportServices, __] = await queryInterface.sequelize.query(`
      SELECT * FROM ${transportServicesTable}
    `);
    for (const ts of transportServices) {
      await queryInterface.bulkUpdate('Services', {
        type: ts.protocol,
        externalPort: ts.externalPort,
        tls: ts.tls
      }, { id: ts.serviceId });
    }

    // Remove transport from enum, leaving only http, tcp, udp
    if (dialect === 'postgres') {
      // Rename the existing enum
      await queryInterface.sequelize.query('ALTER TYPE "enum_Services_type" RENAME TO "enum_Services_type_old"');
      
      // Create new enum with only http, tcp, udp
      await queryInterface.sequelize.query("CREATE TYPE \"enum_Services_type\" AS ENUM ('http', 'tcp', 'udp')");
      
      // Update the column to use the new enum
      await queryInterface.sequelize.query('ALTER TABLE "Services" ALTER COLUMN "type" TYPE "enum_Services_type" USING "type"::text::"enum_Services_type"');
      
      // Drop old enum
      await queryInterface.sequelize.query('DROP TYPE "enum_Services_type_old"');
    } else {
      // SQLite and other databases
      await queryInterface.changeColumn('Services', 'type', {
        type: Sequelize.ENUM('http', 'tcp', 'udp'),
        allowNull: false
      });
    }

    // Recreate old indexes on Services table
    await queryInterface.addIndex('Services', ['externalHostname', 'externalDomainId'], {
      unique: true,
      name: 'services_http_unique_hostname_domain',
      where: {
        type: 'http'
      }
    });

    await queryInterface.addIndex('Services', ['type', 'externalPort'], {
      unique: true,
      name: 'services_layer4_unique_port'
    });

    // Drop child tables
    await queryInterface.dropTable('TransportServices');
    await queryInterface.dropTable('HTTPServices');
  }
};
