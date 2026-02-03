'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Step 1: Add nodeId column (temporarily nullable)
    await queryInterface.addColumn('Containers', 'nodeId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Nodes',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    // Step 2: Populate nodeId based on node string values
    const nodesTable = queryInterface.quoteIdentifier('Nodes');
    const [nodes, _] = await queryInterface.sequelize.query(
      `SELECT id, name FROM ${nodesTable}`
    );
    for (const { id, name } of nodes) {
      await queryInterface.bulkUpdate('Containers', {
        nodeId: id
      }, {
        node: name
      });
    }

    // Step 3: Remove old unique constraint on (node, containerId)
    await queryInterface.removeIndex('Containers', 'containers_node_container_id_unique');

    // Step 4: Make nodeId NOT NULL
    await queryInterface.changeColumn('Containers', 'nodeId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Nodes',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    // Step 5: Remove the old node column
    await queryInterface.removeColumn('Containers', 'node');

    // Step 6: Add new unique constraint on (nodeId, containerId)
    await queryInterface.addIndex('Containers', ['nodeId', 'containerId'], {
      name: 'containers_node_id_container_id_unique',
      unique: true
    });
  },

  async down (queryInterface, Sequelize) {
    // Add back the node column
    await queryInterface.addColumn('Containers', 'node', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    // Populate node from nodeId using a LEFT JOIN to handle case where Nodes table might not exist or is empty
    await queryInterface.sequelize.query(`
      UPDATE "Containers" c
      SET node = n.name
      FROM "Nodes" n
      WHERE c."nodeId" = n.id
    `);

    // Make node NOT NULL
    await queryInterface.changeColumn('Containers', 'node', {
      type: Sequelize.STRING(255),
      allowNull: false
    });

    // Remove new unique constraint
    await queryInterface.removeIndex('Containers', 'containers_node_id_container_id_unique');

    // Restore old unique constraint
    await queryInterface.addIndex('Containers', ['node', 'containerId'], {
      name: 'containers_node_container_id_unique',
      unique: true
    });

    // Remove nodeId column
    await queryInterface.removeColumn('Containers', 'nodeId');
  }
};
