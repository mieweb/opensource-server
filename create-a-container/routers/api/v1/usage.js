/**
 * /api/v1/sites/:siteId/usage — live per-owner resource usage report
 * (issue #440). Computed on demand from one Proxmox `/cluster/resources`
 * call per cluster (utils/usage-collection.js — the same cycle the OTLP
 * usage collector exports).
 *
 * Admin-only for now.
 */

const express = require('express');
const { Site } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, ApiError } = require('../../../middlewares/api');
const { collectUsage } = require('../../../utils/usage-collection');
const { aggregateByOwner } = require('../../../utils/usage-report');

const router = express.Router({ mergeParams: true });

router.use(apiAuth, apiAdmin);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const site = await Site.findByPk(parseInt(req.params.siteId, 10));
    if (!site) throw new ApiError(404, 'site_not_found', 'Site not found');

    const { samples, findings, unknownNodeRows, capacity } = await collectUsage({ siteId: site.id });

    return ok(res, {
      generatedAt: new Date().toISOString(),
      owners: aggregateByOwner(samples),
      // Physical cluster capacity (node rows), for used-vs-capacity charts.
      capacity,
      findings,
      unknownNodeRows,
    });
  }),
);

module.exports = router;
