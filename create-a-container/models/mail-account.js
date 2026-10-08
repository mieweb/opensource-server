'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class MailAccount extends Model {
    static associate(models) {
      MailAccount.belongsTo(models.User, {
        foreignKey: 'uidNumber',
        as: 'owner',
      });
      MailAccount.belongsTo(models.ExternalDomain, {
        foreignKey: 'externalDomainId',
        as: 'domain',
      });
      MailAccount.hasMany(models.MailSuppression, {
        foreignKey: 'mailAccountId',
        as: 'suppressions',
      });
    }
  }

  MailAccount.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    uidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'uidNumber' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      comment: 'Owning user — admin-transferable, never shared',
    },
    externalDomainId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'ExternalDomains', key: 'id' },
      onDelete: 'CASCADE',
    },
    localPart: {
      type: DataTypes.STRING(64),
      allowNull: false,
      validate: {
        // Conservative RFC 5321 dot-atom subset, stored lowercase.
        is: /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/,
      },
      comment: 'Lowercase local part — address is <localPart>@<domain.name>',
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Argon2id PHC string (parallelism 1 for Dovecot compatibility). Never serialized.',
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Disabled accounts disappear from the SQL views — instant lockout',
    },
    quotaBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: 'Mailbox quota enforced by Dovecot (quota-status also rejects at RCPT when over)',
    },
    unsubscribeHeaders: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Add RFC 8058 List-Unsubscribe headers to submitted mail',
    },
    lastRotatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: 'MailAccount',
    tableName: 'MailAccounts',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['externalDomainId', 'localPart'] },
      { fields: ['uidNumber'] },
    ],
  });

  return MailAccount;
};
