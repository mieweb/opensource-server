const { sequelize } = require('../models');

/**
 * Sequelize adapter for oidc-provider
 * Stores tokens, codes, and sessions in the database
 */
class SequelizeAdapter {
  constructor(name) {
    this.name = name;
    this.tableName = this.getTableName(name);
  }

  getTableName(name) {
    const tableMap = {
      'Session': 'OIDCSessions',
      'AccessToken': 'OIDCAccessTokens',
      'AuthorizationCode': 'OIDCAuthorizationCodes',
      'RefreshToken': 'OIDCRefreshTokens',
      'Interaction': 'OIDCInteractions',
      'Grant': 'OIDCSessions', // Reuse sessions table for grants
    };
    return tableMap[name] || 'OIDCSessions';
  }

  async upsert(id, payload, expiresIn) {
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const data = JSON.stringify(payload);

    const record = {
      id,
      data,
      expiresAt,
      uid: payload.uid || null,
      grantId: payload.grantId || null,
      clientId: payload.clientId || null,
      accountId: payload.accountId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Use REPLACE for SQLite compatibility (works like INSERT ... ON DUPLICATE KEY UPDATE)
    await sequelize.query(
      `REPLACE INTO ${this.tableName} (id, data, expiresAt, uid, grantId, clientId, accountId, createdAt, updatedAt)
       VALUES (:id, :data, :expiresAt, :uid, :grantId, :clientId, :accountId, :createdAt, :updatedAt)`,
      {
        replacements: record,
        type: sequelize.QueryTypes.INSERT
      }
    );
  }

  async find(id) {
    const results = await sequelize.query(
      `SELECT * FROM ${this.tableName} WHERE id = :id AND expiresAt > datetime('now') AND consumedAt IS NULL`,
      {
        replacements: { id },
        type: sequelize.QueryTypes.SELECT
      }
    );

    if (!results || results.length === 0) {
      return undefined;
    }

    const result = results[0];
    return {
      ...JSON.parse(result.data),
      ...(result.consumedAt && { consumed: true })
    };
  }

  async findByUserCode(userCode) {
    // Note: JSON extraction in SQLite uses json_extract
    const results = await sequelize.query(
      `SELECT * FROM ${this.tableName} WHERE json_extract(data, '$.userCode') = :userCode AND expiresAt > datetime('now') AND consumedAt IS NULL`,
      {
        replacements: { userCode },
        type: sequelize.QueryTypes.SELECT
      }
    );

    if (!results || results.length === 0) {
      return undefined;
    }

    const result = results[0];
    return {
      ...JSON.parse(result.data),
      ...(result.consumedAt && { consumed: true })
    };
  }

  async findByUid(uid) {
    const results = await sequelize.query(
      `SELECT * FROM ${this.tableName} WHERE uid = :uid AND expiresAt > datetime('now')`,
      {
        replacements: { uid },
        type: sequelize.QueryTypes.SELECT
      }
    );

    return results.map(result => ({
      ...JSON.parse(result.data),
      ...(result.consumedAt && { consumed: true })
    }));
  }

  async destroy(id) {
    await sequelize.query(
      `DELETE FROM ${this.tableName} WHERE id = :id`,
      {
        replacements: { id },
        type: sequelize.QueryTypes.DELETE
      }
    );
  }

  async revokeByGrantId(grantId) {
    await sequelize.query(
      `DELETE FROM ${this.tableName} WHERE grantId = :grantId`,
      {
        replacements: { grantId },
        type: sequelize.QueryTypes.DELETE
      }
    );
  }

  async consume(id) {
    await sequelize.query(
      `UPDATE ${this.tableName} SET consumedAt = datetime('now') WHERE id = :id`,
      {
        replacements: { id },
        type: sequelize.QueryTypes.UPDATE
      }
    );
  }

  static async connect() {
    // Clean up expired tokens periodically
    setInterval(async () => {
      const tables = [
        'OIDCSessions',
        'OIDCAccessTokens',
        'OIDCAuthorizationCodes',
        'OIDCRefreshTokens',
        'OIDCInteractions'
      ];

      for (const table of tables) {
        await sequelize.query(
          `DELETE FROM ${table} WHERE expiresAt < datetime('now')`,
          { type: sequelize.QueryTypes.DELETE }
        );
      }
    }, 60 * 60 * 1000); // Run every hour
  }
}

module.exports = SequelizeAdapter;
