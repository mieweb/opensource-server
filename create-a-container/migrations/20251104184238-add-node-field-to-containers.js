'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Step 1: Add the node column (allow NULL temporarily)
    await queryInterface.addColumn('Containers', 'node', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    // Step 2: Populate node based on aiContainer values
    // FORTWAYNE -> mie-phxdc-ai-pve1
    await queryInterface.bulkUpdate('Containers', 
      { node: 'mie-phxdc-ai-pve1' }, 
      { aiContainer: 'PHOENIX' }
    );

    // PHOENIX -> intern-phxdc-pve3-ai
    await queryInterface.bulkUpdate('Containers', 
      { node: 'intern-phxdc-pve3-ai' }, 
      { aiContainer: 'FORTWAYNE' }
    );

    // quote everything properly
    const containersTable = queryInterface.quoteIdentifier('Containers');
    const aiContainerField = queryInterface.quoteIdentifier('aiContainer');
    const containerIdField = queryInterface.quoteIdentifier('containerId');
    const nodeField = queryInterface.quoteIdentifier('node');

    // N + odd containerId -> intern-phxdc-pve1
    await queryInterface.sequelize.query(
      `UPDATE ${containersTable} 
       SET ${nodeField} = 'intern-phxdc-pve1' 
       WHERE ${aiContainerField} = 'N' AND MOD(${containerIdField}, 2) = 1`
    );

    // N + even containerId -> intern-phxdc-pve2
    await queryInterface.sequelize.query(
      `UPDATE ${containersTable} 
       SET ${nodeField} = 'intern-phxdc-pve2' 
       WHERE ${aiContainerField} = 'N' AND MOD(${containerIdField}, 2) = 0`
    );

    // Step 3: Make node NOT NULL
    await queryInterface.changeColumn('Containers', 'node', {
      type: Sequelize.STRING(255),
      allowNull: false
    });

    // Step 4: Remove unique constraint from containerId
    await queryInterface.removeIndex('Containers', 'containerId');

    // Step 5: Add unique constraint on (node, containerId)
    await queryInterface.addIndex('Containers', ['node', 'containerId'], {
      name: 'containers_node_container_id_unique',
      unique: true
    });
  },

  async down (queryInterface, Sequelize) {
    // Remove the unique constraint on (node, containerId)
    await queryInterface.removeIndex('Containers', 'containers_node_container_id_unique');

    // Restore unique constraint on containerId
    await queryInterface.addIndex('Containers', ['containerId'], {
      name: 'containerId',
      unique: true
    });

    // Remove the node column
    await queryInterface.removeColumn('Containers', 'node');
  }
};
