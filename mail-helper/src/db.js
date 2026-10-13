/**
 * Thin dialect-agnostic access to the read-only mail views (mail_senders_v,
 * mail_suppressions_v) as the mail_postfix role. No host means the local
 * unix socket (Postgres peer / MariaDB socket auth — no password).
 */

'use strict';

class Db {
  constructor(cfg) {
    if (cfg.dialect === 'mysql') {
      const mysql = require('mysql2/promise');
      const pool = mysql.createPool({
        ...(cfg.host ? { host: cfg.host, port: cfg.port ?? 3306 } : { socketPath: '/var/run/mysqld/mysqld.sock' }),
        user: cfg.user,
        ...(cfg.password ? { password: cfg.password } : {}),
        database: cfg.database,
        connectionLimit: 5,
      });
      this.pool = {
        async query(sql, params) {
          const [rows] = await pool.query(sql.replace(/\$\d+/g, '?'), params);
          return { rows };
        },
      };
    } else {
      const { Pool } = require('pg');
      this.pool = new Pool({
        ...(cfg.host ? { host: cfg.host, port: cfg.port ?? 5432 } : { host: '/var/run/postgresql' }),
        user: cfg.user,
        ...(cfg.password ? { password: cfg.password } : {}),
        database: cfg.database ?? undefined,
        max: 5,
      });
    }
  }

  /** Sender account info, or null when the address is not a managed sender. */
  async getSender(address) {
    const { rows } = await this.pool.query(
      'SELECT account_id, unsubscribe_headers FROM mail_senders_v WHERE sender = $1',
      [String(address).toLowerCase()],
    );
    if (!rows[0]) return null;
    const raw = rows[0].unsubscribe_headers; // boolean on Postgres, 0/1 on MySQL
    return {
      accountId: String(rows[0].account_id),
      unsubscribeHeaders: raw === true || raw === 1 || raw === '1',
    };
  }

  async isSuppressed(sender, recipient) {
    const { rows } = await this.pool.query(
      'SELECT 1 AS hit FROM mail_suppressions_v WHERE sender = $1 AND recipient = $2',
      [String(sender).toLowerCase(), String(recipient).toLowerCase()],
    );
    return rows.length > 0;
  }
}

module.exports = { Db };
