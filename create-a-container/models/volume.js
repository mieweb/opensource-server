'use strict';
const { Model } = require('sequelize');

// Name/mount of the retired hardcoded shared mount. The stopgap is fully
// removed: no new container is auto-attached this volume. The name/mount are
// retained only so (a) the backfill migration can record the already-live mount
// on pre-#421 containers as a `builtin` row, and (b) the API can reject a user
// volume that would collide with such a row.
const QUICK_AND_DIRTY_NAME = 'quick_and_dirty';
const QUICK_AND_DIRTY_MOUNT = '/mnt/quick_and_dirty';

// A volume name must be a safe single path segment: no traversal (`..`), no
// path separators, no NUL, and no leading dot. This is the single source of
// truth for name validation, used at ingest and when deriving the host path.
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Validate a user-supplied volume name. Rejects traversal, separators, and
 * anything that isn't a conventional safe path segment.
 * @param {*} name
 * @returns {boolean}
 */
function isValidVolumeName(name) {
  if (typeof name !== 'string') return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  return VALID_NAME.test(name);
}

module.exports = (sequelize, DataTypes) => {
  class Volume extends Model {
    static associate(models) {
      Volume.belongsTo(models.Container, { foreignKey: 'containerId', as: 'container' });
    }

    /**
     * Render this volume to a Proxmox bind-mount `mpN` config value:
     * `<hostPath>,mp=<mountPath>,ro=<0|1>`.
     * @returns {string}
     */
    toMpValue() {
      const ro = this.mode === 'ro' ? 1 : 0;
      return `${this.hostPath},mp=${this.mountPath},ro=${ro}`;
    }

    /**
     * Build the `{ mp0, mp1, ... }` config fragment for a set of volumes,
     * assigning contiguous indices in a stable order (id ascending). This is
     * the single place that maps Volume records to Proxmox mount-point keys, so
     * both the create and reconfigure paths render identical config.
     *
     * Built-in `quick_and_dirty` rows (a backfill artifact for pre-#421
     * containers whose live mount already exists) and any row without a derived
     * host path are skipped — they must never render a new/broken mpN.
     * @param {Volume[]} volumes
     * @returns {object} e.g. { mp0: '...', mp1: '...' }
     */
    static buildMountConfig(volumes) {
      const config = {};
      const mountable = volumes.filter((v) => !v.builtin && v.hostPath);
      const sorted = [...mountable].sort((a, b) => a.id - b.id);
      sorted.forEach((v, i) => {
        config[`mp${i}`] = v.toMpValue();
      });
      return config;
    }

    static get QUICK_AND_DIRTY_NAME() {
      return QUICK_AND_DIRTY_NAME;
    }

    static get QUICK_AND_DIRTY_MOUNT() {
      return QUICK_AND_DIRTY_MOUNT;
    }

    static isValidName(name) {
      return isValidVolumeName(name);
    }
  }

  Volume.init(
    {
      containerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Containers', key: 'id' },
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          isSafeName(value) {
            if (!isValidVolumeName(value)) {
              throw new Error(
                'Volume name must be a safe path segment (letters, digits, dot, dash, underscore; no traversal or separators)',
              );
            }
          },
        },
      },
      hostPath: {
        type: DataTypes.STRING(1024),
        allowNull: true,
      },
      mountPath: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        validate: {
          isAbsolute(value) {
            if (typeof value !== 'string' || !value.startsWith('/')) {
              throw new Error('Volume mountPath must be an absolute path');
            }
          },
        },
      },
      mode: {
        type: DataTypes.ENUM('ro', 'rw'),
        allowNull: false,
        defaultValue: 'rw',
      },
      scope: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'container',
      },
      builtin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'ready', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      statusMessage: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },
      appliedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Volume',
      indexes: [
        { unique: true, fields: ['containerId', 'name'] },
        { unique: true, fields: ['containerId', 'mountPath'] },
      ],
    },
  );

  return Volume;
};

// Constants/validator exported on the factory for non-ORM consumers
// (utils/volumes.js, routers). models/index.js only invokes the factory and
// keys the result by `model.name`, so these attachments don't affect the ORM.
module.exports.isValidVolumeName = isValidVolumeName;
module.exports.QUICK_AND_DIRTY_NAME = QUICK_AND_DIRTY_NAME;
module.exports.QUICK_AND_DIRTY_MOUNT = QUICK_AND_DIRTY_MOUNT;
