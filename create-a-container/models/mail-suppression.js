'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class MailSuppression extends Model {
    static associate(models) {
      MailSuppression.belongsTo(models.MailAccount, {
        foreignKey: 'mailAccountId',
        as: 'account',
      });
    }
  }

  MailSuppression.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    mailAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'MailAccounts', key: 'id' },
      onDelete: 'CASCADE',
    },
    recipient: {
      type: DataTypes.STRING(320),
      allowNull: false,
      set(value) {
        this.setDataValue('recipient', String(value || '').trim().toLowerCase());
      },
      comment: 'Lowercased recipient address that unsubscribed from this account',
    },
    source: {
      type: DataTypes.ENUM('one-click', 'admin'),
      allowNull: false,
      defaultValue: 'one-click',
    },
  }, {
    sequelize,
    modelName: 'MailSuppression',
    tableName: 'MailSuppressions',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['mailAccountId', 'recipient'] },
    ],
  });

  return MailSuppression;
};
