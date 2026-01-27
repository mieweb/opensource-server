'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Containers', 'macAddress', {
      type: Sequelize.STRING(17),
      allowNull: true,
      unique: true
    });
    await queryInterface.changeColumn('Containers', 'ipv4Address', {
      type: Sequelize.STRING(45),
      allowNull: true,
      unique: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Containers', 'macAddress', {
      type: Sequelize.STRING(17),
      allowNull: false,
      unique: true
    });
    await queryInterface.changeColumn('Containers', 'ipv4Address', {
      type: Sequelize.STRING(45),
      allowNull: false,
      unique: true
    });
  }
};
