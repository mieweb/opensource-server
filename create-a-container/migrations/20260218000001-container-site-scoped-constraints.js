'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add siteId column to Containers (nullable initially for backfill)
    await queryInterface.addColumn('Containers', 'siteId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Sites', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    // 2. Backfill siteId from Node
    await queryInterface.sequelize.query(`
      UPDATE "Containers" c
      SET "siteId" = n."siteId"
      FROM "Nodes" n
      WHERE c."nodeId" = n.id
    `);

    // 3. Make siteId NOT NULL after backfill
    await queryInterface.changeColumn('Containers', 'siteId', {
      type: Sequelize.INTEGER,
      allowNull: false
    });

    // 4. Remove duplicate constraints (created by Sequelize changeColumn bug)
    const fks = await queryInterface.getForeignKeyReferencesForTable('Containers');
    const seen = new Set();
    for (const fk of fks) {
      const key = `${fk.columnName}->${fk.referencedTableName}.${fk.referencedColumnName}`;
      if (seen.has(key)) {
        await queryInterface.removeConstraint('Containers', fk.constraintName);
      }
      seen.add(key);
    }

    // 5. Remove global unique constraints on hostname, ipv4Address, macAddress, containerId
    const constraintsToRemove = [
      'Containers_hostname_key',
      'Containers_containerId_key',
      'Containers_ipv4Address_key', 'Containers_ipv4Address_key1',
      'Containers_macAddress_key', 'Containers_macAddress_key1',
    ];
    for (const name of constraintsToRemove) {
      await queryInterface.removeConstraint('Containers', name).catch(() => {});
    }

    // Also remove the old composite index since containerId uniqueness moves to (siteId, nodeId, containerId)
    await queryInterface.removeIndex('Containers', 'containers_node_id_container_id_unique').catch(() => {});

    // 6. Add compound unique constraints scoped to siteId
    await queryInterface.addConstraint('Containers', {
      fields: ['siteId', 'hostname'],
      type: 'unique',
      name: 'containers_site_hostname_unique'
    });
    await queryInterface.addConstraint('Containers', {
      fields: ['siteId', 'ipv4Address'],
      type: 'unique',
      name: 'containers_site_ipv4_unique'
    });
    await queryInterface.addConstraint('Containers', {
      fields: ['siteId', 'macAddress'],
      type: 'unique',
      name: 'containers_site_mac_unique'
    });
    await queryInterface.addConstraint('Containers', {
      fields: ['nodeId', 'containerId'],
      type: 'unique',
      name: 'containers_node_container_id_unique'
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove compound constraints
    await queryInterface.removeConstraint('Containers', 'containers_site_hostname_unique');
    await queryInterface.removeConstraint('Containers', 'containers_site_ipv4_unique');
    await queryInterface.removeConstraint('Containers', 'containers_site_mac_unique');
    await queryInterface.removeConstraint('Containers', 'containers_node_container_id_unique');

    // Restore global unique constraints
    await queryInterface.addConstraint('Containers', {
      fields: ['hostname'],
      type: 'unique',
      name: 'Containers_hostname_key'
    });
    await queryInterface.addConstraint('Containers', {
      fields: ['containerId'],
      type: 'unique',
      name: 'Containers_containerId_key'
    });
    await queryInterface.addConstraint('Containers', {
      fields: ['ipv4Address'],
      type: 'unique',
      name: 'Containers_ipv4Address_key'
    });
    await queryInterface.addConstraint('Containers', {
      fields: ['macAddress'],
      type: 'unique',
      name: 'Containers_macAddress_key'
    });
    await queryInterface.addIndex('Containers', ['nodeId', 'containerId'], {
      unique: true,
      name: 'containers_node_id_container_id_unique'
    });

    // Remove siteId column
    await queryInterface.removeColumn('Containers', 'siteId');
  }
};
