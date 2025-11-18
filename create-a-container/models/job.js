'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Job extends Model {
    static associate(models) {
      Job.hasMany(models.JobStatus, { foreignKey: 'jobId', as: 'statuses' });
    }
  }
  Job.init({
    command: {
      type: DataTypes.STRING(2000),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending','running','success','failure','cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    }
  }, {
    sequelize,
    modelName: 'Job'
  });
  return Job;
};
