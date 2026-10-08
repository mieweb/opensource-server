'use strict';

const { createViewsSql, dropViewsSql } = require('../utils/mail-views');

/**
 * The mail SQL views — the stable contract Dovecot/Postfix (or a
 * self-managed MTA) read live. See utils/mail-views.js for the shape.
 * Grants are NOT done here: bin/setup-mail-db-roles.sh creates the
 * mail_dovecot / mail_postfix users and grants SELECT on the views.
 */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    for (const sql of createViewsSql(dialect)) {
      await queryInterface.sequelize.query(sql);
    }
    // Grant SELECT when the roles already exist (setup-mail-db-roles.sh may
    // run before or after this migration; each side grants best-effort so
    // either ordering converges).
    const grants = [];
    if (dialect === 'postgres') {
      grants.push(
        'GRANT SELECT ON mail_accounts_v TO mail_dovecot',
        'GRANT SELECT ON mail_senders_v, mail_suppressions_v TO mail_postfix',
      );
    } else if (dialect === 'mysql' || dialect === 'mariadb') {
      const db = queryInterface.sequelize.config.database;
      grants.push(
        `GRANT SELECT ON \`${db}\`.mail_accounts_v TO 'mail_dovecot'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_senders_v TO 'mail_postfix'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_suppressions_v TO 'mail_postfix'@'%'`,
      );
    }
    for (const sql of grants) {
      try {
        await queryInterface.sequelize.query(sql);
      } catch {
        /* roles not created yet — the script grants when it creates them */
      }
    }
  },

  async down(queryInterface) {
    for (const sql of dropViewsSql()) {
      await queryInterface.sequelize.query(sql);
    }
  },
};
