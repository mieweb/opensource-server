/**
 * Test database lifecycle + factories.
 *
 * resetDb() drops and recreates the schema from the models (sequelize.sync),
 * which is faster and simpler than running the 56 sequelize-cli migrations
 * per suite. Migrations stay the source of truth for real databases; if a
 * model and its migration disagree, that is a bug to fix, not to paper over
 * here.
 */

const { sequelize, User, Group, ApiKey } = require('../../models');
const { createApiKeyData } = require('../../utils/apikey');

async function resetDb() {
  await sequelize.sync({ force: true });
  // Baseline groups expected by User.afterCreate (primary group + sysadmins).
  await Group.bulkCreate([
    { gidNumber: 2000, cn: 'sysadmins', isAdmin: true },
    { gidNumber: 2001, cn: 'ldapusers', isAdmin: false },
  ]);
}

async function closeDb() {
  await sequelize.close();
}

let uidCounter = 3000;

/**
 * Create a user. NOTE: the first user created after resetDb() is
 * auto-promoted to sysadmins by the User.afterCreate hook — create a
 * throwaway first user (or pass admin: true deliberately) when testing
 * non-admin behavior.
 */
async function createUser(overrides = {}) {
  uidCounter += 1;
  const uid = overrides.uid || `testuser${uidCounter}`;
  const user = await User.create({
    uidNumber: uidCounter,
    uid,
    givenName: 'Test',
    sn: 'User',
    cn: `Test User ${uidCounter}`,
    mail: `${uid}@example.test`,
    userPassword: 'correct horse battery staple',
    status: 'active',
    homeDirectory: `/home/${uid}`,
    ...overrides,
  });
  if (overrides.admin) {
    await user.addGroup(await Group.findByPk(2000));
  }
  return user;
}

/** Create an API key row for a user; returns { apiKey, plainKey }. */
async function createApiKey(user, description = null) {
  const data = await createApiKeyData(user.uidNumber, description);
  const apiKey = await ApiKey.create({
    uidNumber: data.uidNumber,
    keyPrefix: data.keyPrefix,
    keyHash: data.keyHash,
    description: data.description,
  });
  return { apiKey, plainKey: data.plainKey };
}

module.exports = { sequelize, resetDb, closeDb, createUser, createApiKey };
