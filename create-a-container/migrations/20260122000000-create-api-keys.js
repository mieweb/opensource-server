'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ApiKeys', {
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
      keyPrefix: {
        type: Sequelize.STRING(8),
        allowNull: false,
        comment: 'First 8 characters of the API key for identification'
      },
      keyHash: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Argon2 hash of the full API key'
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'User-provided description of the API key purpose'
      },
      lastUsedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Timestamp of when this key was last used'
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

    // Add indexes for performance
    await queryInterface.addIndex('ApiKeys', ['uidNumber'], {
      name: 'apikeys_uidnumber_idx'
    });

    await queryInterface.addIndex('ApiKeys', ['keyPrefix'], {
      name: 'apikeys_keyprefix_idx'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('ApiKeys');
  }
};
