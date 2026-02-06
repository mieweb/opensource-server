'use strict';
const { Model } = require('sequelize');
const crypto = require('crypto');

module.exports = (sequelize, DataTypes) => {
  class InviteToken extends Model {
    static associate(models) {
      // No user association - invite is sent before user exists
    }

    /**
     * Generate a new invite token for an email address
     * @param {string} email - Email address to invite
     * @param {number} expirationHours - Hours until token expires (default: 24)
     * @returns {Promise<{token: string, inviteToken: InviteToken}>}
     */
    static async generateToken(email, expirationHours = 24) {
      const token = crypto.randomBytes(32).toString('hex');
      
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expirationHours);
      
      const inviteToken = await InviteToken.create({
        email: email.toLowerCase().trim(),
        token,
        expiresAt,
        used: false
      });
      
      return { token, inviteToken };
    }

    /**
     * Validate and retrieve a token
     * @param {string} token - The token string
     * @returns {Promise<InviteToken|null>}
     */
    static async validateToken(token) {
      const inviteToken = await InviteToken.findOne({
        where: {
          token,
          used: false
        }
      });
      
      if (!inviteToken) {
        return null;
      }
      
      if (new Date() > inviteToken.expiresAt) {
        return null;
      }
      
      return inviteToken;
    }

    /**
     * Mark token as used
     */
    async markAsUsed() {
      this.used = true;
      await this.save();
    }

    /**
     * Clean up expired and used tokens
     */
    static async cleanup() {
      const now = new Date();
      await InviteToken.destroy({
        where: {
          [sequelize.Sequelize.Op.or]: [
            { expiresAt: { [sequelize.Sequelize.Op.lt]: now } },
            { used: true }
          ]
        }
      });
    }
  }

  InviteToken.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    used: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  }, {
    sequelize,
    modelName: 'InviteToken',
    tableName: 'InviteTokens'
  });

  return InviteToken;
};
