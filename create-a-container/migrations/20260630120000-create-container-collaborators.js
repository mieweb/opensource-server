'use strict';

/**
 * Container sharing: a join table between containers and the additional users
 * (collaborators) who have been granted access to a container. Membership is
 * keyed by `username` (the user's `uid`) to mirror how a container records its
 * primary owner (`Containers.username`).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ContainerCollaborators', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      containerId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Containers', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      username: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    // A user can be a collaborator on a given container at most once.
    await queryInterface.addConstraint('ContainerCollaborators', {
      fields: ['containerId', 'username'],
      type: 'unique',
      name: 'container_collaborators_container_username_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ContainerCollaborators');
  },
};
