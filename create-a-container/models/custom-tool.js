'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CustomTool extends Model {
    static associate(models) {
      // Many-to-many: a custom tool is visible to many groups
      CustomTool.belongsToMany(models.Group, {
        through: models.CustomToolGroup,
        foreignKey: 'customToolId',
        otherKey: 'gidNumber',
        as: 'visibleToGroups'
      });
    }
  }

  CustomTool.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    url: {
      type: DataTypes.STRING(2000),
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'CustomTool',
    tableName: 'CustomTools',
    timestamps: true
  });

  return CustomTool;
};
