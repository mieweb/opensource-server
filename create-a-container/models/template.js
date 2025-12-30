'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Template extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // A Template belongs to a Site
      Template.belongsTo(models.Site, {
        foreignKey: 'siteId',
        as: 'site'
      });
    }
  }
  Template.init({
    displayName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    proxmoxTemplateName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    siteId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Sites',
        key: 'id'
      }
    }
  }, {
    sequelize,
    modelName: 'Template',
  });
  return Template;
};
