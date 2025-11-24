'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('ExternalDomains', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Domain name (e.g., example.com)'
      },
      acmeEmail: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Email address for ACME certificate registration'
      },
      acmeDirectoryUrl: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'ACME directory URL (e.g., https://acme-v02.api.letsencrypt.org/directory)'
      },
      cloudflareApiEmail: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Cloudflare API email for DNS challenge'
      },
      cloudflareApiKey: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Cloudflare API key for DNS challenge'
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

    await queryInterface.addIndex('ExternalDomains', ['siteId']);
    await queryInterface.addIndex('ExternalDomains', ['name'], { unique: true });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('ExternalDomains');
  }
};
