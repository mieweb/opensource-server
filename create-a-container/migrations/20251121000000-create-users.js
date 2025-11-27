'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Users', {
      uidNumber: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true
      },
      uid: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      gidNumber: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      homeDirectory: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      loginShell: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      cn: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      sn: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      givenName: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      mail: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      sshPublicKey: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      userPassword: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'pending'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Users');
  }
};
