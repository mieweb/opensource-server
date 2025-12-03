'use strict';

const GID_MIN = 2000;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('Groups', [
      {
        gidNumber: GID_MIN,
        cn: 'sysadmins',
        isAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        gidNumber: GID_MIN + 1,
        cn: 'ldapusers',
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Groups', {
      gidNumber: [GID_MIN, GID_MIN + 1]
    }, {});
  }
};
