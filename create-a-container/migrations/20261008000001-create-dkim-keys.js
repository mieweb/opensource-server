'use strict';

/** DKIM key pairs per external domain (issue #67). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DkimKeys', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      externalDomainId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'ExternalDomains', key: 'id' },
        onDelete: 'CASCADE',
      },
      selector: { type: Sequelize.STRING(63), allowNull: false },
      privateKey: { type: Sequelize.TEXT, allowNull: false },
      publicKey: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.ENUM('active', 'retired'), allowNull: false, defaultValue: 'active' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('DkimKeys', ['externalDomainId', 'selector'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('DkimKeys');
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_DkimKeys_status";');
    }
  },
};
