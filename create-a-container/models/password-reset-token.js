'use strict';
const { Model } = require('sequelize');
const crypto = require('crypto');

module.exports = (sequelize, DataTypes) => {
  class PasswordResetToken extends Model {
    static associate(models) {
      PasswordResetToken.belongsTo(models.User, {
        foreignKey: 'uidNumber',
        as: 'user'
      });
    }

    /**
     * Generate a new password reset token for a user
     * @param {number} uidNumber - User's UID number
     * @param {number} expirationHours - Hours until token expires (default: 1)
     * @returns {Promise<{token: string, resetToken: PasswordResetToken}>}
     */
    static async generateToken(uidNumber, expirationHours = 1) {
      // Generate a random token
      const token = crypto.randomBytes(32).toString('hex');
      
      // Calculate expiration time
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expirationHours);
      
      // Create the reset token record
      const resetToken = await PasswordResetToken.create({
        uidNumber,
        token,
        expiresAt,
        used: false
      });
      
      return { token, resetToken };
    }

    /**
     * Validate and retrieve a token
     * @param {string} token - The token string
     * @returns {Promise<PasswordResetToken|null>}
     */
    static async validateToken(token) {
      const resetToken = await PasswordResetToken.findOne({
        where: {
          token,
          used: false
        },
        include: [{
          association: 'user',
          required: true
        }]
      });
      
      if (!resetToken) {
        return null;
      }
      
      // Check if token has expired
      if (new Date() > resetToken.expiresAt) {
        return null;
      }
      
      return resetToken;
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
      await PasswordResetToken.destroy({
        where: {
          [sequelize.Sequelize.Op.or]: [
            { expiresAt: { [sequelize.Sequelize.Op.lt]: now } },
            { used: true }
          ]
        }
      });
    }
  }

  PasswordResetToken.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    uidNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'uidNumber'
      }
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
    modelName: 'PasswordResetToken',
    tableName: 'PasswordResetTokens'
  });

  return PasswordResetToken;
};
