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
    }

    /**
     * Returns all external domains sorted so that domains whose default site is
     * this site appear first (in id order), followed by all other domains (also
     * in id order).
     * @returns {Promise<Array>} Sorted array of ExternalDomain instances
     */
    async getSortedExternalDomains() {
      const { ExternalDomain } = sequelize.models;
      const all = await ExternalDomain.findAll({ order: [['id', 'ASC']] });
      const defaults = [];
      const others = [];
      for (const domain of all) {
        if (domain.siteId === this.id) {
          defaults.push(domain);
        } else {
          others.push(domain);
        }
      }
      return [...defaults, ...others];
    }
  }
  Site.init({
    name: DataTypes.STRING,
    internalDomain: DataTypes.STRING,
    dhcpRange: DataTypes.STRING,
    subnetMask: DataTypes.STRING,
    gateway: DataTypes.STRING,
    dnsForwarders: DataTypes.STRING,
    externalIp: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Public IP address used as the target for Cloudflare DNS A records'
    }
  }, {
    sequelize,
    modelName: 'Site',
  });
  return Site;
};