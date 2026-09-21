'use strict';

/**
 * Backfill a built-in `quick_and_dirty` Volume row for every existing container,
 * so the DB reflects the shared read-only mount that create-container.js used to
 * attach via the hardcoded mp0 (issue #421 (b)). These rows are marked
 * `builtin` + `ready` and are NOT re-attached to running containers — existing
 * containers already carry their mp0, so this is purely the DB catching up to
 * reality. hostPath is left null; it is informational and the live mount is
 * untouched.
 *
 * A one-time reconciliation job is enqueued (not raw SQL) because bringing a
 * live LXC's mpN config in line with its Volume rows is a Proxmox
 * updateLxcConfig call, not a DB write. For pre-existing containers the job is a
 * no-op; it is the mechanism by which any newly-attached volume reaches an
 * already-provisioned container on the next reconcile.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const containers = await queryInterface.sequelize.query(
      'SELECT id FROM Containers',
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );

    if (containers && containers.length > 0) {
      const rows = containers.map((c) => ({
        containerId: c.id,
        name: 'quick_and_dirty',
        hostPath: null,
        mountPath: '/mnt/quick_and_dirty',
        mode: 'ro',
        scope: 'container',
        builtin: true,
        status: 'ready',
        statusMessage: null,
        appliedAt: now,
        createdAt: now,
        updatedAt: now,
      }));
      // ignoreDuplicates keeps this idempotent against the (containerId, name)
      // unique index if the migration is re-run.
      await queryInterface.bulkInsert('Volumes', rows, { ignoreDuplicates: true });
    }

    // Enqueue the one-time reconciliation (no-op for pre-existing containers).
    await queryInterface.bulkInsert('Jobs', [
      {
        command: 'node bin/reconcile-volumes.js',
        createdBy: 'system',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Volumes', { builtin: true, name: 'quick_and_dirty' });
  },
};
