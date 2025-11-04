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
    await queryInterface.sequelize.query(
      "UPDATE Containers c JOIN Nodes n ON c.node = n.name SET c.nodeId = n.id"
    );

    // Step 3: Make nodeId NOT NULL
    await queryInterface.changeColumn('Containers', 'nodeId', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Nodes',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    // Step 4: Remove old unique constraint on (node, containerId)
    await queryInterface.removeIndex('Containers', 'containers_node_container_id_unique');

    // Step 5: Add new unique constraint on (nodeId, containerId)
    await queryInterface.addIndex('Containers', ['nodeId', 'containerId'], {
      name: 'containers_node_id_container_id_unique',
      unique: true
    });

    // Step 6: Remove the old node column
    await queryInterface.removeColumn('Containers', 'node');
  },

  async down (queryInterface, Sequelize) {
    // Add back the node column
    await queryInterface.addColumn('Containers', 'node', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    // Populate node from nodeId
    await queryInterface.sequelize.query(
      "UPDATE Containers c JOIN Nodes n ON c.nodeId = n.id SET c.node = n.name"
    );

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
