'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // argon2 hash of the token a container presents when asking the manager
    // whether a user may SSH in. NULL = container not enrolled (SSH open).
    await queryInterface.addColumn('Containers', 'sshAccessTokenHash', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Containers', 'sshAccessTokenHash');
  },
};
