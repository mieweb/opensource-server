'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * A grant giving a user (the `username`/uid) access to a container they do
   * not own — i.e. a shared/collaborative container. The container's primary
   * owner is still `Container.username`; this table only records the extra
   * collaborators.
   */
  class ContainerCollaborator extends Model {
    static associate(models) {
      ContainerCollaborator.belongsTo(models.Container, {
        foreignKey: 'containerId',
        as: 'container',
      });
    }
  }
  ContainerCollaborator.init(
    {
      containerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Containers', key: 'id' },
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        // FK to Users.uid: the database enforces that collaborators exist and
        // cascades user deletion to their grants.
        references: { model: 'Users', key: 'uid' },
      },
    },
    {
      sequelize,
      modelName: 'ContainerCollaborator',
      indexes: [
        {
          name: 'container_collaborators_container_username_unique',
          unique: true,
          fields: ['containerId', 'username'],
        },
      ],
    },
  );
  return ContainerCollaborator;
};
