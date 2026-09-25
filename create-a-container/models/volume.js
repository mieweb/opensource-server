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

/**
 * Canonicalize an absolute guest mount path to a single normal form:
 * collapse duplicate slashes and strip a trailing slash (except root). This is
 * what the reserved-path and per-container uniqueness checks compare against,
 * so equivalent spellings (`/mnt/x/`, `/mnt//x`) can't slip past them.
 * Returns null if the input is not a usable absolute path.
 * @param {*} mountPath
 * @returns {string|null}
 */
function canonicalizeMountPath(mountPath) {
  if (typeof mountPath !== 'string' || !mountPath.startsWith('/')) return null;
  const collapsed = mountPath.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return collapsed === '' ? '/' : collapsed;
}

/**
 * Validate a guest mount path. The value is interpolated into comma-delimited
 * Proxmox `mpN` syntax (`<host>,mp=<mount>,ro=<n>`) and colon-delimited Docker
 * bind syntax (`<host>:<mount>[:ro]`), so beyond "absolute" it must contain no
 * provider delimiters (`,` `:`), no backslash, no whitespace, no control
 * characters (incl. NUL/newline), and no `.`/`..` traversal segments — any of
 * which could corrupt the provider config or override mount options.
 * @param {*} mountPath
 * @returns {boolean}
 */
function isValidMountPath(mountPath) {
  const canon = canonicalizeMountPath(mountPath);
  if (!canon) return false;
  // No provider delimiters, backslash, whitespace, or control chars anywhere.
  // eslint-disable-next-line no-control-regex
  if (/[,:\\\s\u0000-\u001f\u007f]/.test(canon)) return false;
  // Reject traversal / relative segments.
  const segments = canon.split('/').slice(1); // drop leading '' from root
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return false;
  }
  return canon === '/' ? false : true; // a bare '/' mount is not meaningful
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
     * Build the `{ mp1, mp2, ... }` config fragment for a set of volumes.
     *
     * This is the single place that maps Volume records to Proxmox mount-point
     * keys, so both the create and reconfigure paths render identical config.
     *
     * Legacy `builtin` rows (a backfill artifact for pre-#421 containers whose
     * `quick_and_dirty` mount is still live at `mp0`) are NOT rendered — their
     * host path is unknown and the live mount must be preserved. Crucially, the
     * indices they occupy are RESERVED: user volumes are numbered starting AFTER
     * the built-in rows, so the first user volume added to a pre-#421 container
     * lands on `mp<builtinCount>` (e.g. `mp1`) and never overwrites the live
     * `mp0`. Because updateLxcConfig is a partial update, omitting the reserved
     * low indices leaves the legacy mount untouched. Rows without a derived host
     * path are also skipped.
     *
     * @param {Volume[]} volumes
     * @returns {object} e.g. { mp1: '...', mp2: '...' } (mp0 reserved for a
     *   pre-existing built-in mount when present)
     */
    static buildMountConfig(volumes) {
      const config = {};
      // Reserve one low index per legacy built-in mount so user volumes never
      // collide with a still-live mp0 on a pre-#421 container.
      const reserved = volumes.filter((v) => v.builtin).length;
      const mountable = volumes.filter((v) => !v.builtin && v.hostPath);
      const sorted = [...mountable].sort((a, b) => a.id - b.id);
      sorted.forEach((v, i) => {
        config[`mp${reserved + i}`] = v.toMpValue();
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

    static isValidMountPath(mountPath) {
      return isValidMountPath(mountPath);
    }

    static canonicalizeMountPath(mountPath) {
      return canonicalizeMountPath(mountPath);
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
          isSafeMountPath(value) {
            if (!isValidMountPath(value)) {
              throw new Error(
                'Volume mountPath must be an absolute path with no provider delimiters ' +
                  "(',' ':'), backslashes, whitespace, control characters, or '.'/'..' segments",
              );
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
