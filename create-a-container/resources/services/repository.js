const { Service } = require('../../models');

/**
 * Stamp lastAccessedAt = now for one service. A single UPDATE statement —
 * no SELECT, no row instantiation (the endpoint is called by nginx on the
 * hot-ish path and must stay cheap). Returns the affected row count
 * (0 = unknown id).
 */
async function recordAccess(id) {
  const [count] = await Service.update(
    { lastAccessedAt: new Date() },
    { where: { id } },
  );
  return count;
}

module.exports = { recordAccess };
