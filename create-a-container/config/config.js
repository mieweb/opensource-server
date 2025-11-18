require('dotenv').config();

const config = { dialect: process.env.DATABASE_DIALECT || 'sqlite' };
if (config.dialect === 'mysql') {
  config.host = process.env.MYSQL_HOST;
  config.port = process.env.MYSQL_PORT;
  config.username = process.env.MYSQL_USER;
  config.password = process.env.MYSQL_PASSWORD;
  config.database = process.env.MYSQL_DATABASE;
} else if (config.dialect === 'postgres') {
  config.host = process.env.POSTGRES_HOST;
  config.port = process.env.POSTGRES_PORT;
  config.username = process.env.POSTGRES_USER;
  config.password = process.env.POSTGRES_PASSWORD;
  config.database = process.env.POSTGRES_DATABASE;
} else if (config.dialect === 'sqlite') {
  config.storage = process.env.SQLITE_STORAGE || 'data/database.sqlite';
} else {
  throw new Error(`Unsupported Database Dialect: ${process.env.DB_DIALECT}`);
}

module.exports = {
  development: config,
  test: config,
  production: {
    ...config,
    logging: false
  },
};