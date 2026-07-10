'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const settings = [
      { key: 'push_notification_url', value: '', createdAt: now, updatedAt: now },
      { key: 'push_notification_enabled', value: 'false', createdAt: now, updatedAt: now },
    ];

    // Idempotent: only insert keys that don't already exist, so re-running
    // seeders doesn't violate the unique constraint on Settings.key.
    const [existing] = await queryInterface.sequelize.query(
      `SELECT "key" FROM "Settings" WHERE "key" IN (:keys)`,
      { replacements: { keys: settings.map((s) => s.key) } },
    );
    const existingKeys = new Set(existing.map((r) => r.key));
    const toInsert = settings.filter((s) => !existingKeys.has(s.key));
    if (toInsert.length === 0) return;

    await queryInterface.bulkInsert('Settings', toInsert, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Settings', {
      key: ['push_notification_url', 'push_notification_enabled']
    }, {});
  }
};
