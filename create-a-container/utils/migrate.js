'use strict';

/**
 * utils/migrate.js
 *
 * Programmatic database migration runner executed at process startup.
 *
 * Migrations are applied with Umzug (the same library, and the same v2 API,
 * that sequelize-cli uses internally) against the `SequelizeMeta` table, so the
 * set of already-applied migrations is shared byte-for-byte with the
 * `sequelize db:migrate` CLI command. Migrations that have already run are
 * skipped.
 *
 * To guarantee that only one process applies migrations at a time (e.g. when a
 * server is restarting while another instance boots, or alongside any legacy
 * init tooling), the run is wrapped in an engine-appropriate ADVISORY LOCK:
 *
 *   - PostgreSQL: pg_advisory_lock / pg_advisory_unlock (session-scoped). The
 *     lock is taken and released on a single dedicated connection that is held
 *     open for the entire migration batch.
 *   - MySQL/MariaDB: GET_LOCK / RELEASE_LOCK (session-scoped), likewise on a
 *     single dedicated connection.
 *   - SQLite: no advisory-lock primitive exists and concurrent processes
 *     sharing one SQLite file is not a supported production topology, so
 *     locking is skipped (SQLite already serializes writers via its file lock).
 *
 * On failure the error is propagated so the caller can exit non-zero and let
 * the service manager (systemd Restart=on-failure) retry.
 */

const path = require('path');
const Umzug = require('umzug');

// A stable, application-specific identifier for the migration advisory lock.
// Postgres advisory locks are keyed by a signed 64-bit integer; we derive two
// 32-bit "classid"/"objid" halves from a hash of this string and use the
// two-argument form pg_advisory_lock(int4, int4) so the constant is readable
// and collision-resistant against other advisory-lock users.
const LOCK_NAMESPACE = 'create-a-container:migrations';

/**
 * Deterministically derive a pair of signed 32-bit integers from a string,
 * suitable for pg_advisory_lock(classid int4, objid int4). Uses a simple
 * FNV-1a-style hash; the exact algorithm does not matter as long as it is
 * stable across processes and versions.
 *
 * @param {string} str
 * @returns {{ classId: number, objId: number }}
 */
function deriveLockKey(str) {
  // Two independent 32-bit hashes (different offsets) for the two halves.
  const hash32 = (seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime
    }
    // Convert the unsigned 32-bit result to a signed int4 for Postgres.
    return h | 0;
  };
  return { classId: hash32(0x811c9dc5), objId: hash32(0x7ee3623b) };
}

/**
 * Build the Umzug v2 instance bound to the project's migrations directory and
 * the shared Sequelize connection. Each migration is invoked as
 * `up(queryInterface, Sequelize)` / `down(queryInterface, Sequelize)`, matching
 * sequelize-cli's calling convention.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {Umzug.Umzug}
 */
function buildUmzug(sequelize) {
  return new Umzug({
    storage: 'sequelize',
    storageOptions: { sequelize },
    logging: (...args) => console.log('[migrate]', ...args),
    migrations: {
      path: path.join(__dirname, '..', 'migrations'),
      // Pass the same params sequelize-cli passes to migration up()/down().
      // `sequelize.constructor` is the Sequelize class (carries DataTypes etc.).
      params: [sequelize.getQueryInterface(), sequelize.constructor],
      pattern: /^\d.+\.js$/,
    },
  });
}

/**
 * Acquire the advisory lock for the given dialect on a dedicated connection,
 * returning an async release function. For SQLite (or any dialect without an
 * advisory-lock primitive) this is a no-op.
 *
 * The returned release function never throws; it logs and swallows errors so a
 * failure to unlock cannot mask the real migration outcome.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {Promise<() => Promise<void>>}
 */
async function acquireAdvisoryLock(sequelize) {
  const dialect = sequelize.getDialect();

  if (dialect === 'postgres') {
    const { classId, objId } = deriveLockKey(LOCK_NAMESPACE);
    // Hold a single connection for the lifetime of the lock; session-level
    // advisory locks belong to the connection that acquired them.
    const connection = await sequelize.connectionManager.getConnection();
    console.log(`[migrate] acquiring postgres advisory lock (${classId}, ${objId})...`);
    try {
      await connection.query('SELECT pg_advisory_lock($1, $2)', [classId, objId]);
    } catch (err) {
      // Acquisition failed (permission/network error, etc.) — return the
      // connection to the pool so it isn't leaked across startup retries.
      sequelize.connectionManager.releaseConnection(connection);
      throw err;
    }
    console.log('[migrate] postgres advisory lock acquired');
    return async () => {
      try {
        await connection.query('SELECT pg_advisory_unlock($1, $2)', [classId, objId]);
        console.log('[migrate] postgres advisory lock released');
      } catch (err) {
        console.error('[migrate] failed to release postgres advisory lock:', err);
      } finally {
        sequelize.connectionManager.releaseConnection(connection);
      }
    };
  }

  if (dialect === 'mysql' || dialect === 'mariadb') {
    // MySQL GET_LOCK is keyed by a string name; -1 = wait indefinitely.
    const connection = await sequelize.connectionManager.getConnection();
    console.log(`[migrate] acquiring mysql advisory lock "${LOCK_NAMESPACE}"...`);
    let acquired = false;
    try {
      const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAMESPACE, -1]);
      acquired = rows && rows[0] && Number(rows[0].acquired) === 1;
    } catch (err) {
      // Query failed (e.g. connection dropped) before returning — release the
      // connection so it isn't leaked across startup retries.
      sequelize.connectionManager.releaseConnection(connection);
      throw err;
    }
    if (!acquired) {
      sequelize.connectionManager.releaseConnection(connection);
      throw new Error(`Could not acquire MySQL advisory lock "${LOCK_NAMESPACE}" for migrations`);
    }
    console.log('[migrate] mysql advisory lock acquired');
    return async () => {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAMESPACE]);
        console.log('[migrate] mysql advisory lock released');
      } catch (err) {
        console.error('[migrate] failed to release mysql advisory lock:', err);
      } finally {
        sequelize.connectionManager.releaseConnection(connection);
      }
    };
  }

  // sqlite (default) and anything else: no advisory lock available/needed.
  console.log(`[migrate] dialect "${dialect}" has no advisory lock; relying on engine-level serialization`);
  return async () => {};
}

/**
 * Run all pending database migrations, serialized by an engine-appropriate
 * advisory lock. Resolves once migrations are up to date; rejects (without
 * starting the server) if any migration fails.
 *
 * @param {import('sequelize').Sequelize} sequelize - the shared connection from ../models
 * @returns {Promise<string[]>} names of migrations that were applied this run
 */
async function runMigrations(sequelize) {
  const release = await acquireAdvisoryLock(sequelize);
  try {
    const umzug = buildUmzug(sequelize);
    const pending = await umzug.pending();
    if (pending.length === 0) {
      console.log('[migrate] database schema is up to date; no migrations to run');
      return [];
    }
    console.log(`[migrate] applying ${pending.length} pending migration(s)...`);
    const applied = await umzug.up();
    const names = applied.map((m) => m.file);
    console.log(`[migrate] applied ${names.length} migration(s): ${names.join(', ')}`);
    return names;
  } finally {
    await release();
  }
}

module.exports = { runMigrations };
