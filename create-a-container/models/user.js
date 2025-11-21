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
