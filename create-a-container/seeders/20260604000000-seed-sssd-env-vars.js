'use strict';

// Variables seeded into the default_container_env_vars setting for the
// base/sssd.conf.template. Only SSSD_LDAP_URI and SSSD_LDAP_TLS_REQCERT
// carry default values; the remaining variables are intentionally left
// blank so that sssd falls back to its builtin defaults.
const SSSD_DEFAULTS = [
  {
    key: 'SSSD_LDAP_URI',
    value: 'ldaps://ldap1:636, ldaps://ldap2:636',
    description: 'Comma-separated list of LDAP server URIs sssd connects to'
  },
  {
    key: 'SSSD_LDAP_TLS_REQCERT',
    value: 'allow',
    description: 'TLS certificate validation policy for LDAP connections (e.g. never, allow, try, demand)'
  },
  {
    key: 'SSSD_LDAP_SCHEMA',
    value: '',
    description: 'LDAP schema type — leave blank to use the sssd builtin default'
  },
  {
    key: 'SSSD_LDAP_SEARCH_BASE',
    value: '',
    description: 'Base DN for LDAP searches — leave blank to use the sssd builtin default'
  },
  {
    key: 'SSSD_LDAP_USER_SEARCH_BASE',
    value: '',
    description: 'Base DN for LDAP user searches — leave blank to use the sssd builtin default'
  },
  {
    key: 'SSSD_LDAP_GROUP_SEARCH_BASE',
    value: '',
    description: 'Base DN for LDAP group searches — leave blank to use the sssd builtin default'
  },
  {
    key: 'SSSD_LDAP_DEFAULT_BIND_DN',
    value: '',
    description: 'DN used to bind to the LDAP server — leave blank to use the sssd builtin default'
  },
  {
    key: 'SSSD_DEFAULT_AUTHTOK_TYPE',
    value: '',
    description: 'Type of the LDAP bind authentication token — leave blank to use the sssd builtin default'
  },
  {
    key: 'SSSD_DEFAULT_AUTHTOK',
    value: '',
    description: 'LDAP bind authentication token — leave blank to use the sssd builtin default'
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
    const toAdd = SSSD_DEFAULTS.filter(e => !existingKeys.has(e.key));
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

    const keysToRemove = new Set(SSSD_DEFAULTS.map(e => e.key));
    const reverted = existing.filter(e => !keysToRemove.has(e.key));

    await queryInterface.sequelize.query(
      `UPDATE "Settings" SET value = :value, "updatedAt" = :now WHERE key = 'default_container_env_vars'`,
      { replacements: { value: JSON.stringify(reverted), now: new Date() } }
    );
  }
};
