const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SessionSecret = sequelize.define('SessionSecret', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    secret: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        len: [32, 64]
      },
      comment: 'Session secret for express-session'
    }
  }, {
    tableName: 'SessionSecrets',
    timestamps: true
  });

  SessionSecret.associate = function(models) {
    // No associations needed
  };

  return SessionSecret;
};
