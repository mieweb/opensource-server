'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Group extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Many-to-many relationship with Users through UserGroups
      Group.belongsToMany(models.User, {
        through: 'UserGroups',
        foreignKey: 'gidNumber',
        otherKey: 'uidNumber',
        as: 'users'
      });
    }
  }
  Group.init({
    gidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    cn: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    isAdmin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  }, {
    sequelize,
    modelName: 'Group',
    tableName: 'Groups',
    timestamps: true
  });
  return Group;
};
