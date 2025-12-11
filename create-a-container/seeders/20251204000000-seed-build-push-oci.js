'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('ScheduledJobs', [
      {
        schedule: '0 3 * * *',
        command: 'node create-a-container/utils/build-push-oci.js',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('ScheduledJobs', {
      command: { [Sequelize.Op.like]: '%build-push-oci%' }
    }, {});
  }
};
