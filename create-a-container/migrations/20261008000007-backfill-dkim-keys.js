'use strict';

const { generateDkimKeyPair } = require('../utils/dkim');

/**
 * Backfill DKIM keys for domains created before issue #67. New domains get
 * a key at create time (routers/api/v1/external-domains.js).
 */
module.exports = {
  async up(queryInterface) {
    const mysql = ['mysql', 'mariadb'].includes(queryInterface.sequelize.getDialect());
    const q = mysql ? (s) => `\`${s}\`` : (s) => `"${s}"`;
    const [domains] = await queryInterface.sequelize.query(
      `SELECT id FROM ${q('ExternalDomains')} WHERE id NOT IN (SELECT ${q('externalDomainId')} FROM ${q('DkimKeys')})`,
    );
    const now = new Date();
    for (const { id } of domains) {
      const { selector, privateKey, publicKey } = generateDkimKeyPair();
      await queryInterface.bulkInsert('DkimKeys', [{
        externalDomainId: id,
        selector,
        privateKey,
        publicKey,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }]);
    }
  },

  async down(queryInterface) {
    // Backfill only — keys for still-existing domains are kept on rollback
    // of this migration; dropping the table removes them anyway.
    void queryInterface;
  },
};
