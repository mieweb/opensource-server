'use strict';

const { Model } = require('sequelize');

/**
 * Default resource values for containers.
 * Requests at or below these values are auto-approved for non-admin users.
 */
const RESOURCE_DEFAULTS = {
  memory: 4096,   // MB
  swap: 0,        // MB
  cpus: 4,
  rootfs: 50,     // GB
};

const VALID_RESOURCE_TYPES = ['memory', 'swap', 'cpus', 'rootfs'];

module.exports = (sequelize, DataTypes) => {
  class ResourceRequest extends Model {
    static associate(models) {
      ResourceRequest.belongsTo(models.Site, { foreignKey: 'siteId', as: 'site' });
    }

    /**
     * Get the effective approved resources for a given container identity.
     * Returns the most recently approved request per resource type.
     * @param {number} siteId
     * @param {string} hostname
     * @param {string} username
     * @returns {Promise<object>} e.g. { memory: 8192, cpus: 4 }
     */
    static async getApprovedResources(siteId, hostname, username) {
      const rows = await ResourceRequest.findAll({
        where: { siteId, hostname, username, status: 'approved' },
        order: [['reviewedAt', 'DESC']],
      });
      const resources = {};
      for (const row of rows) {
        // Only keep the most recent approval per type
        if (!resources[row.resourceType]) {
          resources[row.resourceType] = row.value;
        }
      }
      return resources;
    }
  }

  ResourceRequest.init(
    {
      siteId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      hostname: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      requestedBy: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      resourceType: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
          isIn: [VALID_RESOURCE_TYPES],
        },
      },
      value: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 0,
        },
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
        validate: {
          isIn: [['pending', 'approved', 'denied']],
        },
      },
      comment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      adminComment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      reviewedBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'ResourceRequest',
      tableName: 'ResourceRequests',
      timestamps: true,
    },
  );

  ResourceRequest.RESOURCE_DEFAULTS = RESOURCE_DEFAULTS;
  ResourceRequest.VALID_RESOURCE_TYPES = VALID_RESOURCE_TYPES;

  return ResourceRequest;
};
