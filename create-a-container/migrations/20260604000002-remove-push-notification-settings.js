'use strict';

// Removes the obsolete push-notification 2FA settings. Push-approval 2FA has
// been removed in favor of delegating MFA to an OIDC identity provider.
const PUSH_KEYS = [
  'push_notification_url',
  'push_notification_enabled',
  'push_notification_api_key',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "Settings" WHERE key IN (:keys)`,
      { replacements: { keys: PUSH_KEYS } },
    );
  },

  async down(queryInterface) {
    // Re-create the keys with empty/default values so a rollback restores the
    // previous schema shape (values themselves are not recoverable).
    const now = new Date();
    const rows = [
      { key: 'push_notification_url', value: '' },
      { key: 'push_notification_enabled', value: 'false' },
      { key: 'push_notification_api_key', value: '' },
    ].map((r) => ({ ...r, createdAt: now, updatedAt: now }));
    for (const row of rows) {
      // Avoid duplicate-key errors if a row somehow already exists.
      const [existing] = await queryInterface.sequelize.query(
        `SELECT key FROM "Settings" WHERE key = :key`,
        { replacements: { key: row.key } },
      );
      if (existing.length === 0) {
        await queryInterface.bulkInsert('Settings', [row]);
      }
    }
  },
};
