'use strict';

// Adds SSSD env vars introduced after the initial sssd.conf.template:
//   - SSSD_LDAP_USER_NAME    (login-name attribute; blank => sssd default)
//   - SSSD_LDAP_USER_GECOS   (full-name/gecos attribute; defaults to cn)
//   - SSSD_LDAP_ACCESS_FILTER (login access filter)
//
// This is a separate seeder (rather than an edit to 20260604000000) because
// that seeder is already released and recorded as executed in existing
// databases, so editing it in place would not back-fill the new keys.
//
// SSSD_LDAP_ACCESS_FILTER defaults to a permissive filter that every directory
// entry matches, so out of the box all directory-authenticated users may log
// in. This is deliberate: with access_provider=ldap and
// ldap_access_order=filter, an EMPTY ldap_access_filter denies ALL users, so
// the value must not be left blank. Admins restrict access by setting a more
// specific filter, e.g. (memberOf=cn=allowedusers,ou=Groups,dc=example,dc=com).
const NEW_SSSD_DEFAULTS = [
  {
    key: 'SSSD_LDAP_USER_NAME',
    value: '',
    description: "LDAP attribute mapped to the user's login name. Leave blank to use the sssd builtin default (uid)"
  },
  {
    key: 'SSSD_LDAP_USER_GECOS',
    value: 'cn',
    description: "LDAP attribute mapped to the NSS gecos (full name) field, read by getent/finger and the git-identity script"
  },
  {
    key: 'SSSD_LDAP_ACCESS_FILTER',
    value: '(objectClass=*)',
    description: 'LDAP access filter; users matching it may log in. Defaults to (objectClass=*) so all directory users are allowed. Set a stricter filter (e.g. (memberOf=cn=allowedusers,ou=Groups,dc=example,dc=com)) to restrict access. Must not be blank, which would deny everyone.'
  }
];

function parseEnvVars(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) return parsed;
    // Migrate from the legacy flat-object format {KEY: value} to array format.
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.entries(parsed).map(([key, value]) => ({ key, value, description: '' }));
    }
  } catch (_) {
    /* fall through */
  }
  return [];
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT value FROM "Settings" WHERE key = 'default_container_env_vars'`
    );

    const existing = rows.length > 0 ? parseEnvVars(rows[0].value) : [];
    const existingKeys = new Set(existing.map((e) => e.key));

    // Only add keys that are not already present so an admin's customized
    // values are never overwritten.
    const toAdd = NEW_SSSD_DEFAULTS.filter((e) => !existingKeys.has(e.key));
    if (toAdd.length === 0) return;

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

    const existing = parseEnvVars(rows[0].value);
    const keysToRemove = new Set(NEW_SSSD_DEFAULTS.map((e) => e.key));
    const reverted = existing.filter((e) => !keysToRemove.has(e.key));

    await queryInterface.sequelize.query(
      `UPDATE "Settings" SET value = :value, "updatedAt" = :now WHERE key = 'default_container_env_vars'`,
      { replacements: { value: JSON.stringify(reverted), now: new Date() } }
    );
  }
};
