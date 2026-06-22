'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Idempotent: skip if the key already exists, so re-running seeders doesn't
    // violate the unique constraint on Settings.key.
    const [existing] = await queryInterface.sequelize.query(
      `SELECT "key" FROM "Settings" WHERE "key" = 'push_notification_api_key'`,
    );
    if (existing.length > 0) return;

    const now = new Date();
    await queryInterface.bulkInsert('Settings', [
      { key: 'push_notification_api_key', value: '', createdAt: now, updatedAt: now },
    ], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Settings', {
      key: 'push_notification_api_key'
    }, {});
  }
};
