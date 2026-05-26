'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add siteId column (nullable initially for backfill)
    await queryInterface.addColumn('TransportServices', 'siteId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Sites', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    // 2. Backfill siteId via Service -> Container
    await queryInterface.sequelize.query(`
      UPDATE "TransportServices" ts
      SET "siteId" = c."siteId"
      FROM "Services" s
      JOIN "Containers" c ON s."containerId" = c.id
      WHERE ts."serviceId" = s.id
    `);

    // 3. Make siteId NOT NULL after backfill
    await queryInterface.changeColumn('TransportServices', 'siteId', {
      type: Sequelize.INTEGER,
      allowNull: false
    });

    // 4. Remove duplicate FK constraints introduced by changeColumn (Sequelize bug)
    const fks = await queryInterface.getForeignKeyReferencesForTable('TransportServices');
    const seen = new Set();
    for (const fk of fks) {
      const key = `${fk.columnName}->${fk.referencedTableName}.${fk.referencedColumnName}`;
      if (seen.has(key)) {
        await queryInterface.removeConstraint('TransportServices', fk.constraintName);
      }
      seen.add(key);
    }

    // 5. Drop the global (protocol, externalPort) unique index
    await queryInterface.removeIndex('TransportServices', 'transport_services_unique_protocol_port');

    // 6. Add site-scoped (siteId, protocol, externalPort) unique index
    await queryInterface.addIndex('TransportServices', ['siteId', 'protocol', 'externalPort'], {
      unique: true,
      name: 'transport_services_unique_site_protocol_port'
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove site-scoped index
    await queryInterface.removeIndex('TransportServices', 'transport_services_unique_site_protocol_port');

    // Restore global (protocol, externalPort) unique index
    await queryInterface.addIndex('TransportServices', ['protocol', 'externalPort'], {
      unique: true,
      name: 'transport_services_unique_protocol_port'
    });

    // Remove siteId column
    await queryInterface.removeColumn('TransportServices', 'siteId');
  }
};
