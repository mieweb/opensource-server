'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CustomTools', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      url: {
        type: Sequelize.STRING(2000),
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

    await queryInterface.createTable('CustomToolGroups', {
      customToolId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'CustomTools', key: 'id' },
        onDelete: 'CASCADE'
      },
      gidNumber: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Groups', key: 'gidNumber' },
        onDelete: 'CASCADE'
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

    await queryInterface.addConstraint('CustomToolGroups', {
      fields: ['customToolId', 'gidNumber'],
      type: 'primary key',
      name: 'custom_tool_groups_pkey'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('CustomToolGroups');
    await queryInterface.dropTable('CustomTools');
  }
};
