'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ResourceRequests', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      siteId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Sites', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      hostname: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      username: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      requestedBy: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      resourceType: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      value: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      adminComment: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      reviewedBy: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      reviewedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('ResourceRequests', ['siteId', 'hostname', 'username', 'status'], {
      name: 'resource_requests_lookup',
    });
    await queryInterface.addIndex('ResourceRequests', ['status'], {
      name: 'resource_requests_status',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ResourceRequests');
  },
};
