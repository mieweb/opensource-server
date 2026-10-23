'use strict';

const crypto = require('crypto');

/**
 * Read-only DB roles for the mail stack (issue #67, replaces
 * bin/setup-mail-db-roles.sh per PR #495 review): mail_dovecot (SELECT on
 * mail_accounts_v) and mail_postfix (SELECT on mail_senders_v +
 * mail_suppressions_v).
 *
 * Local mail hosts use socket auth (Postgres peer via the manager image's
 * pg_ident map), so the roles are created without a usable password — on
 * MySQL a random throwaway password blocks TCP logins. Remote mail hosts
 * need the operator to set one (ALTER ROLE ... PASSWORD / ALTER USER).
 *
 * Role creation needs CREATEROLE (granted to the app user by
 * container-creator-init.service). Where the app user lacks the privilege,
 * the statements are logged for a DBA and the migration continues — mail
 * simply stays unavailable until the roles exist.
 */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    let statements = [];
    if (dialect === 'postgres') {
      statements = [
        `DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mail_dovecot') THEN
            CREATE ROLE mail_dovecot LOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mail_postfix') THEN
            CREATE ROLE mail_postfix LOGIN;
          END IF;
        END $$;`,
        'GRANT SELECT ON mail_accounts_v TO mail_dovecot',
        'GRANT SELECT ON mail_senders_v, mail_recipients_v, mail_suppressions_v TO mail_postfix',
      ];
    } else if (dialect === 'mysql' || dialect === 'mariadb') {
      const db = queryInterface.sequelize.config.database;
      const throwaway = () => crypto.randomBytes(24).toString('base64url');
      statements = [
        `CREATE USER IF NOT EXISTS 'mail_dovecot'@'%' IDENTIFIED BY '${throwaway()}'`,
        `CREATE USER IF NOT EXISTS 'mail_postfix'@'%' IDENTIFIED BY '${throwaway()}'`,
        `GRANT SELECT ON \`${db}\`.mail_accounts_v TO 'mail_dovecot'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_senders_v TO 'mail_postfix'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_recipients_v TO 'mail_postfix'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_suppressions_v TO 'mail_postfix'@'%'`,
      ];
    } else {
      return; // SQLite cannot host mail; the views exist for tests only.
    }
    try {
      for (const sql of statements) {
        await queryInterface.sequelize.query(sql);
      }
    } catch (err) {
      console.warn(
        'create-mail-db-roles: could not create the mail DB roles '
        + `(${err.message}). Run the following as a privileged DB user:\n`
        + statements.join(';\n'),
      );
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    try {
      if (dialect === 'postgres') {
        await queryInterface.sequelize.query('DROP ROLE IF EXISTS mail_dovecot');
        await queryInterface.sequelize.query('DROP ROLE IF EXISTS mail_postfix');
      } else if (dialect === 'mysql' || dialect === 'mariadb') {
        await queryInterface.sequelize.query("DROP USER IF EXISTS 'mail_dovecot'@'%'");
        await queryInterface.sequelize.query("DROP USER IF EXISTS 'mail_postfix'@'%'");
      }
    } catch {
      /* lacking privilege — leave the roles for a DBA */
    }
  },
};
