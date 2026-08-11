/**
 * /api/v1/sites/:siteId/usage — live per-owner resource usage report
 * (issue #440). Computed on demand from one Proxmox `/cluster/resources`
 * call per cluster (utils/usage-collection.js — the same cycle the OTLP
 * usage collector exports).
 *
 * Visibility mirrors the containers list: admins see every owner on the
 * site; other users see their own containers plus containers shared with
 * them. Attribution findings (tag/DB drift, unattributed containers) are
 * admin-only.
 */

const express = require('express');
const { Site, ContainerCollaborator } = require('../../../models');
const { apiAuth, asyncHandler, ok, ApiError } = require('../../../middlewares/api');
const { collectUsage } = require('../../../utils/usage-collection');
const { aggregateByOwner } = require('../../../utils/usage-report');

const router = express.Router({ mergeParams: true });

router.use(apiAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const site = await Site.findByPk(parseInt(req.params.siteId, 10));
    if (!site) throw new ApiError(404, 'site_not_found', 'Site not found');

    const { samples, findings, unknownNodeRows } = await collectUsage({ siteId: site.id });

    let visible = samples;
    if (!req.session.isAdmin) {
      const shared = await ContainerCollaborator.findAll({
        where: { username: req.session.user },
        attributes: ['containerId'],
      });
      const sharedIds = new Set(shared.map((row) => row.containerId));
      visible = samples.filter(
        (s) => s.owner === req.session.user || (s.containerDbId && sharedIds.has(s.containerDbId)),
      );
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      owners: aggregateByOwner(visible),
    };
    if (req.session.isAdmin) {
      payload.findings = findings;
      payload.unknownNodeRows = unknownNodeRows;
    }
    return ok(res, payload);
  }),
);

module.exports = router;
