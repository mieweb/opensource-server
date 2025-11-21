'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class UserGroup extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Define associations here if needed
    }
  }
  UserGroup.init({
    uidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      references: {
        model: 'Users',
        key: 'uidNumber'
      }
    },
    gidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      references: {
        model: 'Groups',
        key: 'gidNumber'
      }
    }
  }, {
    sequelize,
    modelName: 'UserGroup',
    tableName: 'UserGroups',
    timestamps: true
  });
  return UserGroup;
};
