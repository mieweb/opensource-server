'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Container extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // a container has many services
      Container.hasMany(models.Service, { foreignKey: 'containerId', as: 'services' });
    }
  }
  Container.init({
    hostname: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    username: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    osRelease: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    containerId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true
    },
    macAddress: {
      type: DataTypes.STRING(17),
      allowNull: false,
      unique: true
    },
    ipv4Address: {
      type: DataTypes.STRING(45),
      allowNull: false,
      unique: true
    },
    aiContainer: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'N'
    },
    publicKey: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Container',
  });
  return Container;
};