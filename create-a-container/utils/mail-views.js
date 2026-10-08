/**
 * Per-dialect SQL for the mail views — the stable contract Dovecot and
 * Postfix read live (see docs: the views are consumed by `mail_dovecot` and
 * `mail_postfix` DB users created by bin/setup-mail-db-roles.sh):
 *
 *   mail_accounts_v     address, password ({ARGON2ID}-prefixed PHC hash),
 *                       home, quota_bytes, can_send, can_receive
 *                       — enabled accounts only (Dovecot passdb/userdb)
 *   mail_senders_v      sender, login, account_id, unsubscribe_headers
 *                       for can-send accounts (Postfix
 *                       smtpd_sender_login_maps; opensource-mail-helper uses
 *                       account_id + unsubscribe_headers to mint
 *                       List-Unsubscribe tokens)
 *   mail_suppressions_v sender, recipient
 *                       (submission policy service — reject at RCPT)
 *
 * SQLite cannot host the mail stack, but the views are still created there so
 * the schema stays identical across dialects for tests.
 */

const VIEW_NAMES = ['mail_accounts_v', 'mail_senders_v', 'mail_suppressions_v'];

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
    `JOIN ${q('ExternalDomains')} ed ON ed.${q('id')} = ma.${q('externalDomainId')}`;

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

module.exports = { VIEW_NAMES, createViewsSql, dropViewsSql };
