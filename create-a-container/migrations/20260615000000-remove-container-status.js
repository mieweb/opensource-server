'use strict';
/** @type {import('sequelize-cli').Migration} */

/**
 * Remove the static `status` column from Containers.
 *
 * Container status is now computed live from Proxmox + job state + config drift
 * (see utils/container-status.js and GET /sites/:id/containers/:id/status), so the
 * persisted column is no longer a source of truth and is dropped.
 *
 * The down migration restores the column (defaulting to 'running') for rollback,
 * but the historical per-container value cannot be recovered.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('Containers', 'status');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('Containers', 'status', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'running',
    });
  },
};
