require('dotenv').config();

const config = {
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  username: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  dialect: 'mysql',
};

module.exports = {
  development: config,
  test: config,
  production: {
    ...config,
    logging: false
  },
};