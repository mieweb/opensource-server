'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ScheduledJob extends Model {
    static associate(models) {
      // ScheduledJob can be associated with created Jobs if needed
    }
  }
  ScheduledJob.init({
    schedule: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Cron-style schedule expression (e.g., "0 2 * * *" for daily at 2 AM)'
    },
    command: {
      type: DataTypes.STRING(2000),
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'ScheduledJob'
  });
  return ScheduledJob;
};
