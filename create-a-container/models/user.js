'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Define associations here if needed in the future
    }
  }
  User.init({
    uidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    uid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    gidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    homeDirectory: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    loginShell: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    cn: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    sn: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    givenName: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    mail: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    sshPublicKey: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    userPassword: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'pending'
    }
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'Users',
    timestamps: true
  });
  return User;
};
