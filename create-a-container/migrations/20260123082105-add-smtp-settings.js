'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const settingsTable = await queryInterface.describeTable('Settings');
    
    // Check if smtp_url already exists
    if (!settingsTable.smtp_url) {
      await queryInterface.bulkInsert('Settings', [
        {
          key: 'smtp_url',
          value: '',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);
    }
    
    // Check if smtp_noreply_address already exists
    if (!settingsTable.smtp_noreply_address) {
      await queryInterface.bulkInsert('Settings', [
        {
          key: 'smtp_noreply_address',
          value: 'noreply@localhost',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Settings', { key: 'smtp_url' });
    await queryInterface.bulkDelete('Settings', { key: 'smtp_noreply_address' });
  }
};
