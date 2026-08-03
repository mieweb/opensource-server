'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Notifications', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      // Emitter of the event, e.g. 'lxc-oomd'.
      source: { type: Sequelize.STRING, allowNull: false },
      // 'info' | 'warning' | 'critical' (validated in the app layer).
      severity: { type: Sequelize.STRING, allowNull: false },
      // Hypervisor node name the event originated on.
      node: { type: Sequelize.STRING, allowNull: true },
      // Container id on the hypervisor (CTID/VMID). STRING to match
      // Containers.containerId, which was widened to a string.
      ctid: { type: Sequelize.STRING, allowNull: true },
      // Owning user (Users.uid). Drives per-user UI visibility. Resolved from
      // node+ctid at ingest time when the payload omits it.
      owner: { type: Sequelize.STRING, allowNull: true },
      // 'freeze' | 'kill' | 'bump' | 'quarantine' | 'detect' | ... (free-form).
      action: { type: Sequelize.STRING, allowNull: true },
      message: { type: Sequelize.TEXT, allowNull: false },
      // Arbitrary structured evidence blob (PSI figures, top procs, ...).
      evidence: { type: Sequelize.JSON, allowNull: true },
      // When the event happened on the node (from the payload's `ts` epoch).
      // Distinct from createdAt, which is when the manager recorded it.
      eventAt: { type: Sequelize.DATE, allowNull: true },
      // Ack state. NULL = unread/unacknowledged.
      acknowledgedAt: { type: Sequelize.DATE, allowNull: true },
      acknowledgedBy: { type: Sequelize.STRING, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });

    // Owner-scoped, unacked-first listing is the hot path (the bell dropdown).
    await queryInterface.addIndex('Notifications', ['owner', 'acknowledgedAt'], {
      name: 'notifications_owner_acknowledged_at',
    });
    await queryInterface.addIndex('Notifications', ['createdAt'], {
      name: 'notifications_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Notifications');
  },
};
