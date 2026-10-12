'use strict';

/**
 * The container a job acts on (create/reconfigure), so the job runner can run
 * a container's jobs one at a time and DELETE can refuse while one is active.
 * No foreign key: a job's history outlives its container.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Jobs', 'containerId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addIndex('Jobs', ['containerId', 'status']);
    // Jobs still queued or running when this deploys named their container
    // only in the command (`--container-id=<id>`).
    const [rows] = await queryInterface.sequelize.query(
      "SELECT id, command FROM Jobs WHERE status IN ('pending', 'running')",
    );
    for (const { id, command } of rows) {
      const m = /(?:^|\s)--container-id=(\d+)(?=\s|$)/.exec(command || '');
      if (m) await queryInterface.bulkUpdate('Jobs', { containerId: Number(m[1]) }, { id });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Jobs', ['containerId', 'status']);
    await queryInterface.removeColumn('Jobs', 'containerId');
  },
};
