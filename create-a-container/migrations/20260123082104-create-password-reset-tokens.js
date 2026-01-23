'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PasswordResetTokens', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      uidNumber: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'uidNumber'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      token: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      used: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
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

    await queryInterface.addIndex('PasswordResetTokens', ['token']);
    await queryInterface.addIndex('PasswordResetTokens', ['uidNumber']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('PasswordResetTokens');
  }
};
