'use strict';

/** Per-user email service accounts (issue #67). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('MailAccounts', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      uidNumber: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'uidNumber' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      externalDomainId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ExternalDomains', key: 'id' },
        onDelete: 'CASCADE',
      },
      localPart: { type: Sequelize.STRING(64), allowNull: false },
      description: { type: Sequelize.STRING(255), allowNull: true },
      passwordHash: { type: Sequelize.STRING(255), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      quotaBytes: { type: Sequelize.BIGINT, allowNull: false },
      unsubscribeHeaders: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      lastRotatedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('MailAccounts', ['externalDomainId', 'localPart'], { unique: true });
    await queryInterface.addIndex('MailAccounts', ['uidNumber']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('MailAccounts');
  },
};
