'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class JobStatus extends Model {
    static associate(models) {
      JobStatus.belongsTo(models.Job, { foreignKey: 'jobId', as: 'job' });
    }
  }
  JobStatus.init({
    jobId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Jobs', key: 'id' }
    },
    output: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'JobStatus'
  });
  return JobStatus;
};
