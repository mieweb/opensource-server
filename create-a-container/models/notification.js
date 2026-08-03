'use strict';

const { Model } = require('sequelize');

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
      source: { type: DataTypes.STRING, allowNull: false },
      severity: { type: DataTypes.STRING, allowNull: false },
      node: { type: DataTypes.STRING, allowNull: true },
      ctid: { type: DataTypes.STRING, allowNull: true },
      owner: { type: DataTypes.STRING, allowNull: true },
      action: { type: DataTypes.STRING, allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      evidence: { type: DataTypes.JSON, allowNull: true },
      eventAt: { type: DataTypes.DATE, allowNull: true },
      acknowledgedAt: { type: DataTypes.DATE, allowNull: true },
      acknowledgedBy: { type: DataTypes.STRING, allowNull: true },
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

  return Notification;
};
