const repo = require('./repository');
const { ApiError } = require('../../middlewares/api');
const { collectUsage } = require('../../utils/usage-collection');
const { aggregateByOwner } = require('../../utils/usage-report');

/**
 * Live per-owner resource usage report for one site (issue #440), computed
 * on demand from one collection cycle (utils/usage-collection.js).
 */
async function getSiteUsage(siteId) {
  const site = await repo.findSiteById(siteId);
  if (!site) throw new ApiError(404, 'site_not_found', 'Site not found');

  const { samples, findings, unknownNodeRows, capacity } = await collectUsage({ siteId: site.id });

  return {
    generatedAt: new Date(),
    owners: aggregateByOwner(samples),
    // Physical cluster capacity (node rows), for used-vs-capacity charts.
    capacity,
    findings,
    unknownNodeRows,
  };
}

module.exports = { getSiteUsage };
