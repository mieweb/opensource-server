'use strict';

/**
 * SQLite's changeColumn recreates the table and accidentally applied a column-
 * level UNIQUE on Containers.nodeId.  A node (Proxmox host) can own many
 * containers, so the constraint is wrong.  The correct uniqueness guarantee is
 * already enforced by the (nodeId, containerId) composite index.
 *
 * Postgres was never affected because its ALTER COLUMN does not rebuild tables.
 * This migration is a no-op on Postgres (removeConstraint on a non-existent
 * constraint will throw, so we guard).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'sqlite') {
      // SQLite requires a full table rebuild to drop a column-level constraint.
      await queryInterface.sequelize.transaction(async (t) => {
        // 1. Create replacement table without the UNIQUE on nodeId
        await queryInterface.sequelize.query(
          `CREATE TABLE "Containers_new" AS SELECT * FROM "Containers" WHERE 0`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(`DROP TABLE "Containers_new"`, { transaction: t });

        // Recreate properly using Sequelize's createTable so the model sync
        // matches.  Easier: use raw DDL mirroring the current schema minus UNIQUE.
        const [[{ sql }]] = await queryInterface.sequelize.query(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='Containers'`,
          { transaction: t },
        );

        // Replace the column-level UNIQUE on nodeId
        const fixed = sql.replace(
          /`nodeId` INTEGER NOT NULL UNIQUE/,
          '`nodeId` INTEGER NOT NULL',
        );

        if (fixed === sql) {
          // Constraint not present — nothing to do
          return;
        }

        const newName = 'Containers_new';
        await queryInterface.sequelize.query(
          fixed.replace(/CREATE TABLE "Containers"/, `CREATE TABLE "${newName}"`),
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `INSERT INTO "${newName}" SELECT * FROM "Containers"`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(`DROP TABLE "Containers"`, { transaction: t });
        await queryInterface.sequelize.query(
          `ALTER TABLE "${newName}" RENAME TO "Containers"`,
          { transaction: t },
        );

        // Recreate the indexes that were on the old table
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "containers_node_id_container_id_unique" ON "Containers" ("nodeId", "containerId")`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "containers_site_hostname_unique_idx" ON "Containers" ("siteId", "hostname")`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "containers_site_ipv4_unique_idx" ON "Containers" ("siteId", "ipv4Address")`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "containers_site_mac_unique_idx" ON "Containers" ("siteId", "macAddress")`,
          { transaction: t },
        );
      });
    }
    // Postgres: nodeId was never accidentally made UNIQUE — nothing to do.
  },

  async down(queryInterface, Sequelize) {
    // Intentionally left empty — restoring the erroneous constraint would be
    // counter-productive.
  },
};
