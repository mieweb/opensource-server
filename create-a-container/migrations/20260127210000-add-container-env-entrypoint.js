'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Containers', 'environmentVars', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null
    });
    
    await queryInterface.addColumn('Containers', 'entrypoint', {
      type: Sequelize.STRING(2000),
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Containers', 'entrypoint');
    await queryInterface.removeColumn('Containers', 'environmentVars');
  }
};
