'use strict';

/** One-click unsubscribe suppressions per mail account (issue #67). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('MailSuppressions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      mailAccountId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'MailAccounts', key: 'id' },
        onDelete: 'CASCADE',
      },
      recipient: { type: Sequelize.STRING(320), allowNull: false },
      source: { type: Sequelize.ENUM('one-click', 'admin'), allowNull: false, defaultValue: 'one-click' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('MailSuppressions', ['mailAccountId', 'recipient'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('MailSuppressions');
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_MailSuppressions_source";');
    }
  },
};
