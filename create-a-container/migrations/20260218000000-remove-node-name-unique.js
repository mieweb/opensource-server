'use strict';

module.exports = {
  async up(queryInterface) {
    try {
      await queryInterface.removeConstraint('Nodes', 'Nodes_name_key');
    } catch (err) {
      if (!/does not exist|no such/i.test(err.message)) throw err;
    }
  },

  async down(queryInterface) {
    await queryInterface.addConstraint('Nodes', {
      fields: ['name'],
      type: 'unique',
      name: 'Nodes_name_key'
    });
  }
};
