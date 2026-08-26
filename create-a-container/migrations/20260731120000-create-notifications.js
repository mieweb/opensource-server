'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Notifications', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      // Emitter of the event, e.g. 'lxc-oomd'.
      source: { type: Sequelize.STRING(255), allowNull: false },
      // Fixed severity vocabulary — a DB ENUM so an out-of-range value is
      // rejected by the database, not just the app layer.
      severity: { type: Sequelize.ENUM('info', 'warning', 'critical'), allowNull: false },
      // Hypervisor node name the event originated on.
      node: { type: Sequelize.STRING(255), allowNull: true },
      // Container id on the hypervisor (CTID/VMID). STRING to match
      // Containers.containerId, which was widened to a string. The physical
      // column is "containerId" (not "ctid"): Postgres reserves "ctid" as a
      // system column on every table, so CREATE TABLE ... "ctid" fails with
      // 42701. The model maps its `ctid` attribute onto this column via
      // Sequelize's `field:` option, so the API/JSON field stays `ctid`.
      containerId: { type: Sequelize.STRING(255), allowNull: true },
      // Owning user (Users.uid). Drives per-user UI visibility. Resolved from
      // node+ctid at ingest time when the payload omits it.
      owner: { type: Sequelize.STRING(255), allowNull: true },
      // Free-form action label (e.g. 'freeze', 'kill', 'bump', 'quarantine',
      // 'detect'). Deliberately not an ENUM: node-side tools may emit new
      // actions without a schema migration.
      action: { type: Sequelize.STRING(255), allowNull: true },
      message: { type: Sequelize.TEXT, allowNull: false },
      // Arbitrary structured evidence blob (PSI figures, top procs, ...).
      evidence: { type: Sequelize.JSON, allowNull: true },
      // When the event happened on the node (from the payload's `ts` epoch).
      // Distinct from createdAt, which is when the manager recorded it.
      eventAt: { type: Sequelize.DATE, allowNull: true },
      // Ack state. NULL = unread/unacknowledged.
      acknowledgedAt: { type: Sequelize.DATE, allowNull: true },
      acknowledgedBy: { type: Sequelize.STRING(255), allowNull: true },
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
    // Postgres leaves the ENUM type behind after the table is dropped and needs
    // an explicit DROP TYPE; SQLite/MySQL have no such type object (and SQLite
    // errors on the statement), so only run it on Postgres.
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Notifications_severity";');
    }
  },
};
