'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Fix: Restore ON DELETE CASCADE to Services.containerId foreign key
    // This was lost during the 20251202180408-refactor-services-to-sti migration
    // when columns were removed
    
    await queryInterface.changeColumn('Services', 'containerId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Containers',
        key: 'id'
      },
      onDelete: 'CASCADE'
    });
  },

  async down(queryInterface, Sequelize) {
    // This migration fixes a bug, so down migration would recreate the bug
    // We'll leave the constraint as-is
    await queryInterface.changeColumn('Services', 'containerId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Containers',
        key: 'id'
      }
    });
  }
};
