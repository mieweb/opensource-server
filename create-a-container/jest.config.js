/** Server-side test config (see docs/mvc-manifesto.md §5). */
module.exports = {
  testEnvironment: 'node',
  // Resource tests live in resources/<r>/__tests__/, shared/middleware tests
  // in their own __tests__/ folders. The client has its own toolchain.
  testMatch: ['**/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/client/'],
  // Env must be pinned before any module requires config/config.js.
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  // DB-backed suites share one sqlite file; keep workers serialized.
  maxWorkers: 1,
  // List every individual test, not just suite results.
  verbose: true,
};
