'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DkimKey extends Model {
    static associate(models) {
      DkimKey.belongsTo(models.ExternalDomain, {
        foreignKey: 'externalDomainId',
        as: 'domain',
      });
    }
  }

  DkimKey.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    externalDomainId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'ExternalDomains', key: 'id' },
      onDelete: 'CASCADE',
    },
    selector: {
      type: DataTypes.STRING(63),
      allowNull: false,
      comment: 'DKIM selector — the DNS record lives at <selector>._domainkey.<domain>',
    },
    privateKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'PEM RSA private key. Never serialized in API responses; sent only in the mail-host snapshot and the admin DKIM export.',
    },
    publicKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Base64 DER (SPKI) public key — the p= value of the DNS TXT record',
    },
    status: {
      type: DataTypes.ENUM('active', 'retired'),
      allowNull: false,
      defaultValue: 'active',
    },
  }, {
    sequelize,
    modelName: 'DkimKey',
    tableName: 'DkimKeys',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['externalDomainId', 'selector'] },
    ],
  });

  return DkimKey;
};
