'use strict';

/**
 * Adds a `nodeType` discriminator to Nodes so the app can select the right
 * API client implementation (NodeApi surface):
 *   - 'proxmox' (default): real Proxmox host, uses ProxmoxApi.
 *   - 'dummy': dev-only mock hypervisor, uses DummyApi.
 *
 * Existing rows are backfilled to 'proxmox' via the column default, so every
 * production node keeps its current behaviour. Portable across Postgres and
 * SQLite (plain string column + default, no ENUM).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'nodeType', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'proxmox'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Nodes', 'nodeType');
  }
};
