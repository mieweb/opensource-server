'use strict';
const { Model } = require('sequelize');

// Retired keys keep verifying previously issued unsubscribe links for this long.
const RETIRED_KEY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

module.exports = (sequelize, DataTypes) => {
  class MailUnsubscribeKey extends Model {
    /** True when this key may still verify tokens (active, or retired within retention). */
    canVerify(now = Date.now()) {
      if (this.status === 'active') return true;
      return now - new Date(this.updatedAt).getTime() < RETIRED_KEY_RETENTION_MS;
    }
  }

  MailUnsubscribeKey.init({
    kid: {
      type: DataTypes.STRING(16),
      primaryKey: true,
      allowNull: false,
      comment: 'Short key id embedded (unencrypted) in unsubscribe tokens',
    },
    secret: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'Base64 of 32 random bytes (AES-256-GCM key). Never serialized; sent only in the mail-host snapshot.',
    },
    status: {
      type: DataTypes.ENUM('active', 'retired'),
      allowNull: false,
      defaultValue: 'active',
    },
  }, {
    sequelize,
    modelName: 'MailUnsubscribeKey',
    tableName: 'MailUnsubscribeKeys',
    timestamps: true,
  });

  return MailUnsubscribeKey;
};
