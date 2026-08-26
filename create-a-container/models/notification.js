'use strict';

const { Model } = require('sequelize');

const SEVERITIES = ['info', 'warning', 'critical'];

module.exports = (sequelize, DataTypes) => {
  class Notification extends Model {
    static associate(/* models */) {
      // Intentionally unassociated. `owner` is a loose reference to Users.uid
      // and `node`/`ctid` loosely reference a Container; events must survive
      // deletion of the container or user they describe, so no FK constraints.
    }
  }

  Notification.init(
    {
      source: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true },
      },
      // Closed vocabulary — a DB ENUM (see the migration) plus an isIn guard so
      // the failure is a clean validation error rather than a dialect-specific
      // constraint error.
      severity: {
        type: DataTypes.ENUM(...SEVERITIES),
        allowNull: false,
        validate: { isIn: [SEVERITIES] },
      },
      node: { type: DataTypes.STRING(255), allowNull: true },
      // Physical column is "containerId": Postgres reserves "ctid" as a system
      // column name, so the table cannot have a column literally named "ctid".
      // The attribute stays `ctid` (API/JSON/query surface unchanged) and maps
      // onto the containerId column via `field`.
      ctid: { type: DataTypes.STRING(255), allowNull: true, field: 'containerId' },
      owner: { type: DataTypes.STRING(255), allowNull: true },
      // Free-form (node-side tools may emit new actions); bounded length only.
      action: { type: DataTypes.STRING(255), allowNull: true },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { notEmpty: true },
      },
      evidence: { type: DataTypes.JSON, allowNull: true },
      eventAt: { type: DataTypes.DATE, allowNull: true },
      acknowledgedAt: { type: DataTypes.DATE, allowNull: true },
      acknowledgedBy: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      sequelize,
      modelName: 'Notification',
      indexes: [
        { fields: ['owner', 'acknowledgedAt'], name: 'notifications_owner_acknowledged_at' },
        { fields: ['createdAt'], name: 'notifications_created_at' },
      ],
    }
  );

  Notification.SEVERITIES = SEVERITIES;

  return Notification;
};
