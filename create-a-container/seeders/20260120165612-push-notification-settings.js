'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('Settings', [
      {
        key: 'push_notification_url',
        value: '',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        key: 'push_notification_enabled',
        value: 'false',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Settings', {
      key: ['push_notification_url', 'push_notification_enabled']
    }, {});
  }
};
