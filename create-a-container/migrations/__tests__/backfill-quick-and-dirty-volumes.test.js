/**
 * Guard for the Postgres identifier-quoting bug (issue #421 review B1): the
 * backfill migration must quote the `Containers` table name in its raw query,
 * or Postgres case-folds it to `containers` and crashes the Manager on startup
 * (`relation "containers" does not exist`). SQLite is case-insensitive, so the
 * sqlite migration round-trip can't catch this — this test asserts the
 * migration issues a properly quoted identifier regardless of dialect.
 */

const path = require('path');

const migration = require(path.join(
  __dirname,
  '..',
  '20260722130000-backfill-quick-and-dirty-volumes.js',
));

describe('backfill-quick-and-dirty-volumes migration', () => {
  test('quotes the Containers identifier in its raw SELECT', async () => {
    const queries = [];
    // Minimal queryInterface stub capturing the raw SQL and mimicking
    // Sequelize's real quoteIdentifier (double-quoted, mixed case preserved).
    const queryInterface = {
      quoteIdentifier: (id) => `"${id}"`,
      sequelize: {
        QueryTypes: { SELECT: 'SELECT' },
        query: async (sql) => {
          queries.push(sql);
          return []; // no existing containers
        },
      },
      bulkInsert: async () => {},
      bulkDelete: async () => {},
    };

    await migration.up(queryInterface, {});

    const selects = queries.filter((q) => /select/i.test(q));
    expect(selects.length).toBeGreaterThan(0);
    for (const sql of selects) {
      // Must reference the quoted, mixed-case table name...
      expect(sql).toContain('"Containers"');
      // ...and never the bare unquoted identifier that Postgres would fold.
      expect(sql).not.toMatch(/FROM\s+Containers\b/);
    }
  });
});
