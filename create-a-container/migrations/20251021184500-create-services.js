"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Services table: each service belongs to a Container
    await queryInterface.createTable('Services', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      containerId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Containers',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      type: {
        type: Sequelize.ENUM('tcp','udp','http'),
        allowNull: false
      },
      internalPort: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      }
    });

    // tcp_udp_service_info for layer 4 services
    await queryInterface.createTable('Layer4Services', {
      serviceId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: {
          model: 'Services',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      externalPort: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false
      },
      tls: {
        // only used for tcp services; allowed to be null for udp
        type: Sequelize.BOOLEAN,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      }
    });

    // http_service_info for HTTP services
    await queryInterface.createTable('HttpServices', {
      serviceId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
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
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('HttpServices');
    await queryInterface.dropTable('Layer4Services');
    await queryInterface.dropTable('Services');
  }
};
