'use strict';

const GID_MIN = 2000;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const groups = [
      { gidNumber: GID_MIN, cn: 'sysadmins', isAdmin: true, createdAt: now, updatedAt: now },
      { gidNumber: GID_MIN + 1, cn: 'ldapusers', isAdmin: false, createdAt: now, updatedAt: now },
    ];

    // Idempotent: only insert groups that don't already exist, so re-running
    // seeders (e.g. `make dev`) doesn't violate the unique constraints on
    // gidNumber/cn.
    const [existing] = await queryInterface.sequelize.query(
      `SELECT "gidNumber" FROM "Groups" WHERE "gidNumber" IN (:gids)`,
      { replacements: { gids: groups.map((g) => g.gidNumber) } },
    );
    const existingGids = new Set(existing.map((r) => r.gidNumber));
    const toInsert = groups.filter((g) => !existingGids.has(g.gidNumber));
    if (toInsert.length === 0) return;

    await queryInterface.bulkInsert('Groups', toInsert, {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Groups', {
      gidNumber: [GID_MIN, GID_MIN + 1]
    }, {});
  }
};
