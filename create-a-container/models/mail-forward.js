'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class MailForward extends Model {
    static associate(models) {
      MailForward.belongsTo(models.MailAccount, {
        foreignKey: 'mailAccountId',
        as: 'account',
      });
    }
  }

  MailForward.init({
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
    address: {
      type: DataTypes.STRING(254),
      allowNull: false,
      set(value) {
        this.setDataValue('address', String(value || '').trim().toLowerCase());
      },
      comment: 'Lowercased destination that receives a copy of inbound mail (mail_forwards_v)',
    },
  }, {
    sequelize,
    modelName: 'MailForward',
    tableName: 'MailForwards',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['mailAccountId', 'address'] },
    ],
  });

  return MailForward;
};
