'use strict';

/** AES-256-GCM keys for unsubscribe tokens (issue #67). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('MailUnsubscribeKeys', {
      kid: { type: Sequelize.STRING(16), primaryKey: true, allowNull: false },
      secret: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.ENUM('active', 'retired'), allowNull: false, defaultValue: 'active' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('MailUnsubscribeKeys');
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_MailUnsubscribeKeys_status";');
    }
  },
};
