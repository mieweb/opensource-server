'use strict';

// Variables seeded into the default_container_env_vars setting.
// Add future cross-container variables here and create a new seeder
// that calls the same merge logic.
const WAZUH_DEFAULTS = [
  {
    key: 'WAZUH_MANAGER',
    value: '',
    description: 'Hostname of the Wazuh manager for agent enrollment (e.g. wazuh.example.com)'
  },
  {
    key: 'WAZUH_REGISTRATION_PASSWORD',
    value: '',
    description: 'Enrollment password for Wazuh agent registration — deleted from /etc/environment inside the container immediately after first-boot enrollment completes'
  }
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT value FROM "Settings" WHERE key = 'default_container_env_vars'`
    );

    let existing = [];
    if (rows.length > 0) {
      try {
        const parsed = JSON.parse(rows[0].value);
        if (Array.isArray(parsed)) {
          existing = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
          // Migrate from old flat-object format {KEY: value} to array format
          existing = Object.entries(parsed).map(([key, value]) => ({ key, value, description: '' }));
        }
      } catch (_) {
        existing = [];
      }
    }

    const existingKeys = new Set(existing.map(e => e.key));
    const toAdd = WAZUH_DEFAULTS.filter(e => !existingKeys.has(e.key));
    if (toAdd.length === 0) return; // all keys already present

    const merged = [...existing, ...toAdd];
    const now = new Date();

    if (rows.length > 0) {
      await queryInterface.sequelize.query(
        `UPDATE "Settings" SET value = :value, "updatedAt" = :now WHERE key = 'default_container_env_vars'`,
        { replacements: { value: JSON.stringify(merged), now } }
      );
    } else {
      await queryInterface.bulkInsert('Settings', [{
        key: 'default_container_env_vars',
        value: JSON.stringify(merged),
        createdAt: now,
        updatedAt: now
      }]);
    }
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT value FROM "Settings" WHERE key = 'default_container_env_vars'`
    );
    if (rows.length === 0) return;

    let existing = [];
    try {
      const parsed = JSON.parse(rows[0].value);
      existing = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return;
    }

    const keysToRemove = new Set(WAZUH_DEFAULTS.map(e => e.key));
    const reverted = existing.filter(e => !keysToRemove.has(e.key));

    await queryInterface.sequelize.query(
      `UPDATE "Settings" SET value = :value, "updatedAt" = :now WHERE key = 'default_container_env_vars'`,
      { replacements: { value: JSON.stringify(reverted), now: new Date() } }
    );
  }
};
