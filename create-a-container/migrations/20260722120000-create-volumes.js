'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Volumes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      containerId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Containers', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      // Host directory bind-mounted into the container. Derived from the node
      // storage's actual configured path (never assumed to be /mnt/pve/<storage>).
      // Null until the create job derives it.
      hostPath: {
        type: Sequelize.STRING(1024),
        allowNull: true,
      },
      // Guest mount point (e.g. /mnt/data).
      mountPath: {
        type: Sequelize.STRING(1024),
        allowNull: false,
      },
      mode: {
        type: Sequelize.ENUM('ro', 'rw'),
        allowNull: false,
        defaultValue: 'rw',
      },
      // Anticipates per-user/site/node volumes; v1 is per-container only.
      scope: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'container',
      },
      // Whether this is the built-in shared read-only volume (formerly the
      // hardcoded quick_and_dirty mp0). Built-ins are never rendered as a
      // separate agent-provisioned directory and are seeded ready.
      builtin: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Directory-readiness lifecycle owned by the agent (pending -> ready|failed).
      // The create job blocks on this before setting the bind mount.
      status: {
        type: Sequelize.ENUM('pending', 'ready', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      statusMessage: {
        type: Sequelize.STRING(2000),
        allowNull: true,
      },
      appliedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    // A container can only mount one volume per host path and one per mount
    // point; both are enforced so a reconfigure can't double-attach.
    await queryInterface.addIndex('Volumes', ['containerId', 'name'], {
      unique: true,
      name: 'volumes_container_id_name_unique',
    });
    await queryInterface.addIndex('Volumes', ['containerId', 'mountPath'], {
      unique: true,
      name: 'volumes_container_id_mount_path_unique',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Volumes');
    // Postgres materializes ENUMs as types that dropTable does not remove.
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Volumes_mode";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Volumes_status";');
    }
  },
};
