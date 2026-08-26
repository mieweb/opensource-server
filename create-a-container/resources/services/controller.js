const svc = require('./service');
const { asyncHandler, noContent } = require('../../middlewares/api');

const recordAccess = asyncHandler(async (req, res) => {
  await svc.recordAccess(req.validated.params.id);
  return noContent(res);
});

module.exports = { recordAccess };
