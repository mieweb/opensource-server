'use strict';

/**
 * Agent service reporting + the mail-host claim (issue #67).
 *
 * The partial unique index over the constant (1) allows at most ONE row in
 * the whole table with a non-null mailHostSince — the single-mail-host
 * invariant enforced at the DB level on Postgres and SQLite. MySQL/MariaDB
 * have no partial indexes; there the claim is serialized in application code
 * (utils/mail-host.js runs it inside a transaction).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Agents', 'enabledServices', {
      type: Sequelize.JSON, allowNull: true,
    });
    await queryInterface.addColumn('Agents', 'missingBinaries', {
      type: Sequelize.JSON, allowNull: true,
    });
    await queryInterface.addColumn('Agents', 'mailHostSince', {
      type: Sequelize.DATE, allowNull: true,
    });
    await queryInterface.addColumn('Agents', 'isLocal', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
    await queryInterface.addColumn('Agents', 'apiKeyId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'ApiKeys', key: 'id' },
      onDelete: 'SET NULL',
    });

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX "agents_single_mail_host" ON "Agents" ((1)) WHERE "mailHostSince" IS NOT NULL;',
      );
    } else if (dialect === 'sqlite') {
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX `agents_single_mail_host` ON `Agents` (1) WHERE `mailHostSince` IS NOT NULL;',
      );
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres' || dialect === 'sqlite') {
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS "agents_single_mail_host";');
    }
    await queryInterface.removeColumn('Agents', 'apiKeyId');
    await queryInterface.removeColumn('Agents', 'isLocal');
    await queryInterface.removeColumn('Agents', 'mailHostSince');
    await queryInterface.removeColumn('Agents', 'missingBinaries');
    await queryInterface.removeColumn('Agents', 'enabledServices');
  },
};
