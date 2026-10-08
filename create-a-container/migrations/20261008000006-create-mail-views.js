'use strict';

const { createViewsSql, dropViewsSql } = require('../utils/mail-views');

/**
 * The mail SQL views — the stable contract Dovecot/Postfix (or a
 * self-managed MTA) read live. See utils/mail-views.js for the shape.
 * Grants are NOT done here: bin/setup-mail-db-roles.sh creates the
 * mail_dovecot / mail_postfix users and grants SELECT on the views.
 */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    for (const sql of createViewsSql(dialect)) {
      await queryInterface.sequelize.query(sql);
    }
  },

  async down(queryInterface) {
    for (const sql of dropViewsSql()) {
      await queryInterface.sequelize.query(sql);
    }
  },
};
