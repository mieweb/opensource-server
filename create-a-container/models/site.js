'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Site extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // A Site has many Nodes
      Site.hasMany(models.Node, {
        foreignKey: 'siteId',
        as: 'nodes'
      });
      
      // A Site has many ExternalDomains
      Site.hasMany(models.ExternalDomain, {
        foreignKey: 'siteId',
        as: 'externalDomains'
      });
      
      // A Site has many Templates
      Site.hasMany(models.Template, {
        foreignKey: 'siteId',
        as: 'templates'
      });
    }
  }
  Site.init({
    name: DataTypes.STRING,
    internalDomain: DataTypes.STRING,
    dhcpRange: DataTypes.STRING,
    subnetMask: DataTypes.STRING,
    gateway: DataTypes.STRING,
    dnsForwarders: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Site',
  });
  return Site;
};