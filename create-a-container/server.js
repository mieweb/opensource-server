/**
 * Process startup: apply pending migrations, fetch DB-backed session secrets,
 * build the app (app.js), and listen. Keep this file free of HTTP behavior —
 * anything a request can observe belongs in app.js so it is covered by the
 * test suite.
 */

require('dotenv').config();

const crypto = require('crypto');
const { sequelize, SessionSecret } = require('./models');
const { runMigrations } = require('./utils/migrate');
const { buildApp } = require('./app');

// Function to get or create session secrets
async function getSessionSecrets() {
  const secrets = await SessionSecret.findAll({
    order: [['createdAt', 'DESC']],
    attributes: ['secret']
  });

  if (secrets.length === 0) {
    // Generate a new secret if none exist
    const newSecret = crypto.randomBytes(32).toString('hex');
    await SessionSecret.create({ secret: newSecret });
    console.log('Generated new session secret');
    return [newSecret];
  }

  return secrets.map(s => s.secret);
}

async function main() {
  // Apply any pending database migrations before serving traffic
  await runMigrations(sequelize);

  const app = buildApp({ sessionSecrets: await getSessionSecrets() });

  const PORT = 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

main().catch(err => {
  console.error('Fatal: server failed to start:', err);
  process.exit(1);
});
