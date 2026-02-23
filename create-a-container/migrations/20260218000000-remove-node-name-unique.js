'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.removeConstraint('Nodes', 'Nodes_name_key');
  },

  async down(queryInterface) {
    await queryInterface.addConstraint('Nodes', {
      fields: ['name'],
      type: 'unique',
      name: 'Nodes_name_key'
    });
  }
};
