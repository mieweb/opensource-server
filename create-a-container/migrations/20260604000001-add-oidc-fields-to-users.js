'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'oidcSubject', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'oidcIssuer', {
      type: Sequelize.STRING(255),
      allowNull: true
    });
    // OIDC subjects are only unique within an issuer; enforce uniqueness on the
    // (issuer, subject) pair so the same subject can't collide across IdPs.
    await queryInterface.addIndex('Users', ['oidcIssuer', 'oidcSubject'], {
      name: 'users_oidc_issuer_subject_unique',
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Users', 'users_oidc_issuer_subject_unique');
    await queryInterface.removeColumn('Users', 'oidcIssuer');
    await queryInterface.removeColumn('Users', 'oidcSubject');
  }
};
