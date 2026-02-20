'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Discover and remove all FK constraints on siteId
    const fks = await queryInterface.getForeignKeyReferencesForTable('ExternalDomains');
    for (const fk of fks) {
      if (fk.columnName === 'siteId') {
        await queryInterface.removeConstraint('ExternalDomains', fk.constraintName);
      }
    }

    // Allow NULL so external domains can exist without a default site
    await queryInterface.changeColumn('ExternalDomains', 'siteId', {
      type: Sequelize.INTEGER,
      allowNull: true
    });

    // Re-add FK with ON DELETE SET NULL so removing a site clears the default
    await queryInterface.addConstraint('ExternalDomains', {
      fields: ['siteId'],
      type: 'foreign key',
      name: 'ExternalDomains_siteId_fkey',
      references: { table: 'Sites', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface, Sequelize) {
    const fks = await queryInterface.getForeignKeyReferencesForTable('ExternalDomains');
    for (const fk of fks) {
      if (fk.columnName === 'siteId') {
        await queryInterface.removeConstraint('ExternalDomains', fk.constraintName);
      }
    }

    await queryInterface.changeColumn('ExternalDomains', 'siteId', {
      type: Sequelize.INTEGER,
      allowNull: false
    });

    await queryInterface.addConstraint('ExternalDomains', {
      fields: ['siteId'],
      type: 'foreign key',
      name: 'ExternalDomains_siteId_fkey',
      references: { table: 'Sites', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });
  }
};
