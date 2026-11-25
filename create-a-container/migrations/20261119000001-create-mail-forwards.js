'use strict';

/**
 * Per-account mail forwarding.
 *
 *   MailForwards              up to 5 destination addresses per account
 *   MailAccounts.forwardKeepCopy  also deliver to the account's own mailbox
 *   mail_forwards_v           source, destination — one row per destination,
 *                             plus (source, source) when keeping a copy.
 *                             Postfix virtual_alias_maps joins the rows with
 *                             commas; a self-reference stops alias expansion
 *                             and delivers locally. Only live, enabled
 *                             accounts on can-receive domains appear.
 */

// Dialect fragments mirroring 20261008000006-create-mail-views, duplicated
// on purpose: applied migrations are frozen, so later ones never import them.
function forwardsViewSql(dialect) {
  const mysql = dialect === 'mysql' || dialect === 'mariadb';
  const q = mysql ? (s) => `\`${s}\`` : (s) => `"${s}"`;
  const cat = mysql
    ? (...parts) => `CONCAT(${parts.join(', ')})`
    : (...parts) => parts.join(' || ');

  const address = `LOWER(${cat(`ma.${q('localPart')}`, "'@'", `ed.${q('name')}`)})`;
  const canReceive = `(ed.${q('mailEnabled')} AND ed.${q('mailMxVerified')})`;
  const live = `ma.${q('deletedAt')} IS NULL`;
  const accountJoins =
    `JOIN ${q('ExternalDomains')} ed ON ed.${q('id')} = ma.${q('externalDomainId')} ` +
    `JOIN ${q('Users')} u ON u.${q('uidNumber')} = ma.${q('uidNumber')} AND u.${q('status')} = 'active'`;
  const joins = `FROM ${q('MailAccounts')} ma ${accountJoins}`;
  const gate = `${live} AND ma.${q('enabled')} AND ${canReceive}`;
  return (
    'CREATE VIEW mail_forwards_v AS ' +
    `SELECT ${address} AS source, mf.${q('address')} AS destination ` +
    `FROM ${q('MailForwards')} mf ` +
    `JOIN ${q('MailAccounts')} ma ON ma.${q('id')} = mf.${q('mailAccountId')} ${accountJoins} ` +
    `WHERE ${gate} ` +
    'UNION ALL ' +
    `SELECT ${address} AS source, ${address} AS destination ${joins} ` +
    `WHERE ${gate} AND ma.${q('forwardKeepCopy')} ` +
    `AND EXISTS (SELECT 1 FROM ${q('MailForwards')} mf WHERE mf.${q('mailAccountId')} = ma.${q('id')})`
  );
}

function grantSql(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  if (dialect === 'postgres') return 'GRANT SELECT ON mail_forwards_v TO mail_postfix';
  if (dialect === 'mysql' || dialect === 'mariadb') {
    return `GRANT SELECT ON \`${queryInterface.sequelize.config.database}\`.mail_forwards_v TO 'mail_postfix'@'%'`;
  }
  return null;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('MailForwards', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      mailAccountId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'MailAccounts', key: 'id' },
        onDelete: 'CASCADE',
      },
      address: { type: Sequelize.STRING(254), allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('MailForwards', ['mailAccountId', 'address'], { unique: true });
    await queryInterface.addColumn('MailAccounts', 'forwardKeepCopy', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    await queryInterface.sequelize.query(forwardsViewSql(queryInterface.sequelize.getDialect()));

    const grant = grantSql(queryInterface);
    if (grant) {
      try {
        await queryInterface.sequelize.query(grant);
      } catch (err) {
        console.warn(`create-mail-forwards: could not grant (${err.message}). Once the mail_* roles exist, run as a privileged DB user:\n${grant}`);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP VIEW IF EXISTS mail_forwards_v');
    await queryInterface.removeColumn('MailAccounts', 'forwardKeepCopy');
    await queryInterface.dropTable('MailForwards');
  },
};
