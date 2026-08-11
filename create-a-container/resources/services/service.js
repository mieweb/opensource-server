const repo = require('./repository');
const { ApiError } = require('../../middlewares/api');

async function recordAccess(id) {
  const count = await repo.recordAccess(id);
  if (count === 0) throw new ApiError(404, 'not_found', 'Service not found');
}

module.exports = { recordAccess };
