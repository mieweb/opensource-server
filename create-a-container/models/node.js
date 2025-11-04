'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Node extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // A node has many containers
      Node.hasMany(models.Container, { foreignKey: 'nodeId', as: 'containers' });
    }
  }
  Node.init({
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    apiUrl: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    tlsVerify: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Node',
  });
  return Node;
};