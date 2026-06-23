'use strict';

// Seeds the two built-in groups (sysadmins, ldapusers).
const GID_MIN = 2000;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const groups = [
      { gidNumber: GID_MIN, cn: 'sysadmins', isAdmin: true, createdAt: now, updatedAt: now },
      { gidNumber: GID_MIN + 1, cn: 'ldapusers', isAdmin: false, createdAt: now, updatedAt: now },
    ];

    // Idempotent: only insert groups that don't already exist.
    const [existing] = await queryInterface.sequelize.query(
      `SELECT "gidNumber" FROM "Groups" WHERE "gidNumber" IN (:gids)`,
      { replacements: { gids: groups.map((g) => g.gidNumber) } },
    );
    const existingGids = new Set(existing.map((r) => r.gidNumber));
    const toInsert = groups.filter((g) => !existingGids.has(g.gidNumber));
    if (toInsert.length === 0) return;

    await queryInterface.bulkInsert('Groups', toInsert, {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('Groups', {
      gidNumber: [GID_MIN, GID_MIN + 1]
    }, {});
  }
};
