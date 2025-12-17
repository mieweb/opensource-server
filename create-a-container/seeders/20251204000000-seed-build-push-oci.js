'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // This seeder is now superseded by 20251203000000-seed-oci-build-job.js
    // which uses the combined oci-build-push-pull.js job.
    // Keeping this file for migration rollback support only.
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('ScheduledJobs', {
      command: { [Sequelize.Op.like]: '%build-push-oci%' }
    }, {});
  }
};
