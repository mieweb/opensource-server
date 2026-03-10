'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class GlobalOneShotCommand extends Model {
    static associate() {
      // No associations needed — these are global admin-managed commands
    }
  }

  GlobalOneShotCommand.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    command: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'GlobalOneShotCommand',
    tableName: 'GlobalOneShotCommands',
    timestamps: true
  });

  return GlobalOneShotCommand;
};
