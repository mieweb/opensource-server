'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CustomToolGroup extends Model {
    static associate() {}
  }

  CustomToolGroup.init({
    customToolId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      references: { model: 'CustomTools', key: 'id' }
    },
    gidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      references: { model: 'Groups', key: 'gidNumber' }
    }
  }, {
    sequelize,
    modelName: 'CustomToolGroup',
    tableName: 'CustomToolGroups',
    timestamps: true
  });

  return CustomToolGroup;
};
