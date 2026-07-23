/**
 * Jest setupFiles hook — runs before any test module is loaded, so these
 * values win over .env (dotenv never overrides pre-set variables).
 *
 * Each jest worker gets its own sqlite file (":memory:" is unusable here:
 * Sequelize pools connections and every new sqlite connection would see a
 * different empty in-memory database).
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_DIALECT = 'sqlite';
process.env.SQLITE_STORAGE = `${require('os').tmpdir()}/create-a-container-test-${process.env.JEST_WORKER_ID || 0}.sqlite`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL === 'trace' ? 'trace' : 'info';
