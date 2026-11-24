'use strict';

/**
 * Re-run of 20261012000000-create-mail-db-roles. Managers built before the
 * mail stack lacked CREATEROLE, so that migration only logged its SQL and was
 * still recorded as done. The opensource-server postinst now grants
 * CREATEROLE to the app user on local-Postgres managers before restarting, so
 * this retry creates the roles there. Idempotent (IF NOT EXISTS + GRANT).
 */
const createMailDbRoles = require('./20261012000000-create-mail-db-roles');

module.exports = {
  up: (queryInterface) => createMailDbRoles.up(queryInterface),
  // Dropping is left to the original migration's down().
  async down() {},
};
