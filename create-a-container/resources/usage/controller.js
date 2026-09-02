const svc = require('./service');
const { serializeUsageReport } = require('./serializer');
const { asyncHandler, ok } = require('../../middlewares/api');

const report = asyncHandler(async (req, res) => {
  const usage = await svc.getSiteUsage(req.validated.params.siteId);
  return ok(res, serializeUsageReport(usage));
});

module.exports = { report };
