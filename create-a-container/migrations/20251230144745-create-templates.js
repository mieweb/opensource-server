'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Templates', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      displayName: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Human-readable template name'
      },
      proxmoxTemplateName: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Proxmox template identifier (e.g., local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst)'
      },
      siteId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Sites',
          key: 'id'
        },
        onUpdate: 'CASCADE',
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
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Templates');
  }
};
