'use strict';

/**
 * Separate storage for persistent (bind-mount) volumes from container rootfs
 * storage. Rootfs can live on thin-provisioned block storage (lvmthin/rbd/zfs)
 * while volumes need a path-backed shared filesystem (cephfs/nfs). Nullable:
 * when unset, volumes fall back to `volumeStorage` (previous behavior).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Nodes', 'sharedVolumeStorage', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null,
      after: 'volumeStorage'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Nodes', 'sharedVolumeStorage');
  }
};
