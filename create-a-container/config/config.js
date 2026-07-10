require('dotenv').config();

// SQL query logging is noisy (e.g. the job-runner polls the Jobs table on every
// tick), so it is gated behind the most verbose log level. Only LOG_LEVEL=trace
// enables Sequelize query logging — in both development and production. Any
// other level (or unset) keeps it off.
const sqlLogging = (process.env.LOG_LEVEL || '').toLowerCase() === 'trace' ? console.log : false;

const config = { dialect: process.env.DATABASE_DIALECT || 'sqlite', logging: sqlLogging };
if (config.dialect === 'mysql') {
  config.host = process.env.MYSQL_HOST;
  config.port = process.env.MYSQL_PORT;
  config.username = process.env.MYSQL_USER;
  config.password = process.env.MYSQL_PASSWORD;
  config.database = process.env.MYSQL_DATABASE;
} else if (config.dialect === 'postgres') {
  config.host = process.env.POSTGRES_HOST;
  config.port = process.env.POSTGRES_PORT;
  config.username = process.env.POSTGRES_USER;
  config.password = process.env.POSTGRES_PASSWORD;
  config.database = process.env.POSTGRES_DATABASE;
} else if (config.dialect === 'sqlite') {
  config.storage = process.env.SQLITE_STORAGE || 'data/database.sqlite';
  // SQLite is a development-only convenience (production uses Postgres). Use the
  // actively-maintained @vscode/sqlite3 fork instead of the unmaintained sqlite3
  // package; it builds from source (no prebuilt-binary glibc mismatches) and is
  // a dev dependency, so it is required lazily here — only when the sqlite
  // dialect is actually selected — and never loaded in production.
  try {
    config.dialectModule = require('@vscode/sqlite3');
  } catch (err) {
    throw new Error(
      "DATABASE_DIALECT=sqlite requires the '@vscode/sqlite3' dev dependency. " +
        "Install dev dependencies (e.g. `npm install` / `make dev`), or set " +
        'DATABASE_DIALECT=postgres for production.',
    );
  }
} else {
  throw new Error(`Unsupported Database Dialect: ${config.dialect}`);
}

module.exports = {
  development: config,
  test: config,
  // Query logging is controlled solely by LOG_LEVEL (trace), so production uses
  // the same config — it stays silent unless LOG_LEVEL=trace is set.
  production: config,
};