'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('ScheduledJobs', [
      {
        schedule: '0 2 * * *',
        command: 'node create-a-container/bin/oci-build-job.js',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('ScheduledJobs', {
      command: { [Sequelize.Op.like]: '%oci-build-job%' }
    }, {});
  }
};
