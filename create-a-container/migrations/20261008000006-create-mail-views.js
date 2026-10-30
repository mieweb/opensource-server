'use strict';

/**
 * The mail SQL views — the stable contract Dovecot/Postfix (or a
 * self-managed MTA) read live:
 *
 *   mail_accounts_v     address, password ({ARGON2ID}-prefixed PHC hash),
 *                       home, quota_bytes, can_send, can_receive
 *                       — enabled accounts only (Dovecot passdb/userdb)
 *   mail_senders_v      sender, login, account_id, unsubscribe_headers
 *                       for can-send accounts (Postfix
 *                       smtpd_sender_login_maps; opensource-mail-helper uses
 *                       account_id + unsubscribe_headers to mint
 *                       List-Unsubscribe tokens)
 *   mail_recipients_v   recipient — deliverable addresses on can-receive
 *                       domains (Postfix virtual_mailbox_maps: unknown
 *                       recipients rejected at RCPT, no backscatter)
 *   mail_suppressions_v sender, recipient
 *                       (submission milter — reject at RCPT)
 *
 * SQLite cannot host the mail stack, but the views are still created there so
 * the schema stays identical across dialects for tests.
 *
 * Grants are NOT done here: the mail_dovecot / mail_postfix roles are created
 * by migration 20261012000000, which grants SELECT on the views.
 */

const VIEW_NAMES = ['mail_accounts_v', 'mail_senders_v', 'mail_recipients_v', 'mail_suppressions_v'];

/**
 * Build the CREATE VIEW statements for a dialect.
 * @param {string} dialect - 'postgres' | 'mysql' | 'mariadb' | 'sqlite'
 * @returns {string[]} ordered CREATE VIEW statements
 */
function createViewsSql(dialect) {
  const mysql = dialect === 'mysql' || dialect === 'mariadb';
  // Identifier quoting
  const q = mysql ? (s) => `\`${s}\`` : (s) => `"${s}"`;
  // String concatenation
  const cat = mysql
    ? (...parts) => `CONCAT(${parts.join(', ')})`
    : (...parts) => parts.join(' || ');

  const address = `LOWER(${cat(`ma.${q('localPart')}`, "'@'", `ed.${q('name')}`)})`;
  const canSend = `(ed.${q('mailEnabled')} AND ed.${q('mailDnsVerified')})`;
  const canReceive = `(ed.${q('mailEnabled')} AND ed.${q('mailMxVerified')})`;
  const joins =
    `FROM ${q('MailAccounts')} ma ` +
    `JOIN ${q('ExternalDomains')} ed ON ed.${q('id')} = ma.${q('externalDomainId')} ` +
    `JOIN ${q('Users')} u ON u.${q('uidNumber')} = ma.${q('uidNumber')} AND u.${q('status')} = 'active'`;

  return [
    `CREATE VIEW mail_accounts_v AS ` +
      `SELECT ${address} AS address, ` +
      `${cat("'{ARGON2ID}'", `ma.${q('passwordHash')}`)} AS password, ` +
      `${cat("'/var/vmail/'", `ma.${q('id')}`)} AS home, ` +
      `ma.${q('quotaBytes')} AS quota_bytes, ` +
      `${canSend} AS can_send, ` +
      `${canReceive} AS can_receive ` +
      `${joins} WHERE ma.${q('enabled')}`,

    `CREATE VIEW mail_senders_v AS ` +
      `SELECT ${address} AS sender, ${address} AS login, ` +
      `ma.${q('id')} AS account_id, ` +
      `ma.${q('unsubscribeHeaders')} AS unsubscribe_headers ` +
      `${joins} WHERE ma.${q('enabled')} AND ${canSend}`,

    `CREATE VIEW mail_recipients_v AS ` +
      `SELECT ${address} AS recipient ` +
      `${joins} WHERE ma.${q('enabled')} AND ${canReceive}`,

    `CREATE VIEW mail_suppressions_v AS ` +
      `SELECT ${address} AS sender, ms.${q('recipient')} AS recipient ` +
      `FROM ${q('MailSuppressions')} ms ` +
      `JOIN ${q('MailAccounts')} ma ON ma.${q('id')} = ms.${q('mailAccountId')} ` +
      `JOIN ${q('ExternalDomains')} ed ON ed.${q('id')} = ma.${q('externalDomainId')}`,
  ];
}

/** DROP statements, reverse order. */
function dropViewsSql() {
  return [...VIEW_NAMES].reverse().map((v) => `DROP VIEW IF EXISTS ${v}`);
}

module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    for (const sql of createViewsSql(dialect)) {
      await queryInterface.sequelize.query(sql);
    }
    // Grant SELECT when the roles already exist (they are created by
    // migration 20261012000000; each side grants best-effort so either
    // ordering converges).
    const grants = [];
    if (dialect === 'postgres') {
      grants.push(
        'GRANT SELECT ON mail_accounts_v TO mail_dovecot',
        'GRANT SELECT ON mail_senders_v, mail_recipients_v, mail_suppressions_v TO mail_postfix',
      );
    } else if (dialect === 'mysql' || dialect === 'mariadb') {
      const db = queryInterface.sequelize.config.database;
      grants.push(
        `GRANT SELECT ON \`${db}\`.mail_accounts_v TO 'mail_dovecot'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_senders_v TO 'mail_postfix'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_recipients_v TO 'mail_postfix'@'%'`,
        `GRANT SELECT ON \`${db}\`.mail_suppressions_v TO 'mail_postfix'@'%'`,
      );
    }
    for (const sql of grants) {
      try {
        await queryInterface.sequelize.query(sql);
      } catch {
        /* roles not created yet — migration 20261012000000 grants then */
      }
    }
  },

  async down(queryInterface) {
    for (const sql of dropViewsSql()) {
      await queryInterface.sequelize.query(sql);
    }
  },
};
