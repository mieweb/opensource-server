/**
 * /api/v1/sites/:siteId/usage — live per-owner resource usage report
 * (issue #440). Admin-only for now.
 */

const express = require('express');
const { apiAuth, apiAdmin } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { siteIdParam } = require('./validator');
const ctrl = require('./controller');

// mergeParams: siteId belongs to the parent /sites/:siteId mount.
const router = express.Router({ mergeParams: true });

router.use(apiAuth, apiAdmin);

router.get('/', validate({ params: siteIdParam }), ctrl.report);

module.exports = router;
