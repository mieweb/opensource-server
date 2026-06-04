'use strict';
const {
  Model
} = require('sequelize');
const argon2 = require('argon2');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Many-to-many relationship with Groups through UserGroups
      User.belongsToMany(models.Group, {
        through: 'UserGroups',
        foreignKey: 'uidNumber',
        otherKey: 'gidNumber',
        as: 'groups'
      });
    }

    /**
     * Gets the next available UID number by finding the max and adding 1
     * @returns {Promise<number>} - The next available UID number
     */
    static async nextUidNumber() {
      const maxUidNumber = await User.max('uidNumber');
      // If no users exist, start at 1001 (common starting point for user UIDs)
      return maxUidNumber ? maxUidNumber + 1 : 2000;
    }

    /**
     * Validates a plaintext password against the stored encrypted password
     * @param {string} plainPassword - The plaintext password to validate
     * @returns {boolean} - True if the password matches, false otherwise
     */
    async validatePassword(plainPassword) {
      return await argon2.verify(this.userPassword, plainPassword);
    }

    /**
     * Set a new password for the user
     * @param {string} plainPassword - The new plaintext password
     */
    async setPassword(plainPassword) {
      this.userPassword = plainPassword;
      await this.save();
    }

    /**
     * Generate a unique `uid` from a desired base, appending a numeric suffix
     * if the base is already taken.
     * @param {string} base - Desired username
     * @returns {Promise<string>}
     */
    static async uniqueUid(base) {
      const sanitized = (base || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .replace(/^[._-]+/, '') || 'user';
      let candidate = sanitized;
      let suffix = 1;
      // eslint-disable-next-line no-await-in-loop
      while (await User.findOne({ where: { uid: candidate } })) {
        candidate = `${sanitized}${suffix}`;
        suffix += 1;
      }
      return candidate;
    }

    /**
     * Resolve a local account from validated OIDC claims, optionally creating
     * one when just-in-time provisioning is enabled.
     *
     * Matching order:
     *   1. existing link by oidcSubject
     *   2. existing local user by email (the OIDC identity is then linked)
     *   3. JIT-provisioned new user (only when jitEnabled)
     *
     * @param {object} claims - Normalized claims from utils/oidc handleCallback
     * @param {object} opts
     * @param {boolean} opts.jitEnabled - Whether provisioning is permitted
     * @returns {Promise<{user: User|null, code?: string}>}
     */
    static async findOrProvisionFromOidc(claims, { jitEnabled } = {}) {
      const includeGroups = { include: [{ association: 'groups' }] };

      if (claims.sub) {
        const linked = await User.findOne({
          where: { oidcSubject: claims.sub },
          ...includeGroups,
        });
        if (linked) return { user: linked };
      }

      if (claims.email) {
        const byEmail = await User.findOne({
          where: { mail: claims.email },
          ...includeGroups,
        });
        if (byEmail) {
          // Link the OIDC identity to the existing local account.
          if (!byEmail.oidcSubject && claims.sub) {
            byEmail.oidcSubject = claims.sub;
            byEmail.oidcIssuer = claims.issuer || null;
            await byEmail.save();
          }
          return { user: byEmail };
        }
      }

      if (!jitEnabled) {
        return { user: null, code: 'no_account' };
      }

      if (!claims.email) {
        return { user: null, code: 'missing_email' };
      }

      const crypto = require('crypto');
      const base = claims.preferredUsername || claims.email.split('@')[0];
      const uid = await User.uniqueUid(base);
      const givenName = (claims.givenName || claims.name || uid).trim();
      const familyName = (claims.familyName || '').trim() || givenName;

      await User.create({
        uidNumber: await User.nextUidNumber(),
        uid,
        givenName,
        sn: familyName,
        cn: claims.name?.trim() || `${givenName} ${familyName}`.trim(),
        mail: claims.email,
        // OIDC users authenticate via the IdP; store a random unusable secret
        // so the NOT NULL password column is satisfied without a known password.
        userPassword: crypto.randomBytes(32).toString('hex'),
        status: 'active',
        homeDirectory: `/home/${uid}`,
        oidcSubject: claims.sub || null,
        oidcIssuer: claims.issuer || null,
      });

      const created = await User.findOne({ where: { uid }, ...includeGroups });
      return { user: created };
    }
  }
  User.init({
    uidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
    },
    uid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    gidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2001 // Default to ldapusers group
    },
    homeDirectory: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    loginShell: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: '/bin/bash'
    },
    cn: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    sn: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    givenName: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    mail: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    sshPublicKey: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    userPassword: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'pending'
    },
    oidcSubject: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true
    },
    oidcIssuer: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'Users',
    timestamps: true,
    hooks: {
      beforeCreate: async (user, options) => {
        // Hash password
        user.userPassword = await argon2.hash(user.userPassword);
      },
      afterCreate: async (user, options) => {
        const { Group } = sequelize.models;
        
        // Add user to ldapusers group
        const primaryGroup = await Group.findByPk(user.gidNumber);
        await user.addGroup(primaryGroup);
        
        // Check if this is the first user
        const userCount = await User.count();
        if (userCount === 1) {
          // Add first user to sysadmins group
          const sysadminsGroup = await Group.findByPk(2000);
          if (sysadminsGroup) {
            await user.addGroup(sysadminsGroup);
          }
        }
      },
      beforeUpdate: async (user, options) => {
        if (user.changed('userPassword')) {
          user.userPassword = await argon2.hash(user.userPassword);
        }
      }
    }
  });
  return User;
};
