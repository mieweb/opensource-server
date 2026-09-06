'use strict';

// Seeds MANAGER_URL into default_container_env_vars. Containers call back to
// this URL to ask whether a user may SSH in (see ssh-access router).
const MANAGER_DEFAULTS = [
  {
    key: 'MANAGER_URL',
    value: '',
    description:
      'Public base URL of this manager, reachable from containers (e.g. https://manager.example.com). Required for per-container SSH access enforcement.',
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT value FROM "Settings" WHERE key = 'default_container_env_vars'`,
    );

    let existing = [];
    if (rows.length > 0) {
      try {
        const parsed = JSON.parse(rows[0].value);
        if (Array.isArray(parsed)) {
          existing = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
          existing = Object.entries(parsed).map(([key, value]) => ({ key, value, description: '' }));
        }
      } catch (_) {
        existing = [];
      }
    }

    const existingKeys = new Set(existing.map((e) => e.key));
    const toAdd = MANAGER_DEFAULTS.filter((e) => !existingKeys.has(e.key));
    if (toAdd.length === 0) return;

    const merged = [...existing, ...toAdd];
    const now = new Date();

    if (rows.length > 0) {
      await queryInterface.sequelize.query(
        `UPDATE "Settings" SET value = :value, "updatedAt" = :now WHERE key = 'default_container_env_vars'`,
        { replacements: { value: JSON.stringify(merged), now } },
      );
    } else {
      await queryInterface.bulkInsert('Settings', [
        { key: 'default_container_env_vars', value: JSON.stringify(merged), createdAt: now, updatedAt: now },
      ]);
    }
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT value FROM "Settings" WHERE key = 'default_container_env_vars'`,
    );
    if (rows.length === 0) return;
    let existing;
    try {
      existing = JSON.parse(rows[0].value);
    } catch (_) {
      return;
    }
    if (!Array.isArray(existing)) return;
    const remove = new Set(MANAGER_DEFAULTS.map((e) => e.key));
    const filtered = existing.filter((e) => !remove.has(e.key));
    await queryInterface.sequelize.query(
      `UPDATE "Settings" SET value = :value, "updatedAt" = :now WHERE key = 'default_container_env_vars'`,
      { replacements: { value: JSON.stringify(filtered), now: new Date() } },
    );
  },
};
