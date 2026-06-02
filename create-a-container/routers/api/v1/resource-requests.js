/**
 * /api/v1/resource-requests — Resource request management.
 * Users can request resource adjustments for their containers.
 * Admins can view and approve/deny pending requests.
 */

const express = require('express');
const {
  ResourceRequest,
  Container,
  Site,
  sequelize,
} = require('../../../models');
const {
  apiAuth,
  apiAdmin,
  asyncHandler,
  ok,
  created,
  noContent,
  ApiError,
} = require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth);

const { RESOURCE_DEFAULTS, VALID_RESOURCE_TYPES } = ResourceRequest;

/**
 * Determine if a request should be auto-approved:
 * - Admin users always get auto-approved
 * - Requests for values <= the default are auto-approved
 */
function shouldAutoApprove(isAdmin, resourceType, value) {
  if (isAdmin) return true;
  const defaultValue = RESOURCE_DEFAULTS[resourceType];
  if (defaultValue === undefined) return false;
  return value <= defaultValue;
}

// GET / — list resource requests
// Admins see all (optionally filtered by status), users see only their own
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = {};
    if (!req.session.isAdmin) {
      where.requestedBy = req.session.user;
    }
    if (req.query.status) {
      where.status = req.query.status;
    }
    if (req.query.siteId) {
      where.siteId = parseInt(req.query.siteId, 10);
    }
    const rows = await ResourceRequest.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [{ association: 'site', attributes: ['id', 'name'] }],
    });
    return ok(res, rows);
  }),
);

// GET /count — get count of pending requests (for badge display)
router.get(
  '/count',
  asyncHandler(async (req, res) => {
    const count = await ResourceRequest.count({ where: { status: 'pending' } });
    return ok(res, { count });
  }),
);

// GET /effective/:siteId/:hostname/:username — get effective approved resources
router.get(
  '/effective/:siteId/:hostname/:username',
  asyncHandler(async (req, res) => {
    const { siteId, hostname, username } = req.params;
    // Users can only query their own, admins can query any
    if (!req.session.isAdmin && username !== req.session.user) {
      throw new ApiError(403, 'forbidden', 'Cannot view resources for other users');
    }
    const resources = await ResourceRequest.getApprovedResources(
      parseInt(siteId, 10),
      hostname,
      username,
    );
    return ok(res, { ...RESOURCE_DEFAULTS, ...resources });
  }),
);

// POST / — create a resource request
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { siteId, hostname, resourceType, value, comment } = req.body || {};

    if (!siteId) throw new ApiError(400, 'invalid_request', 'siteId is required');
    if (!hostname || !hostname.trim()) throw new ApiError(400, 'invalid_request', 'hostname is required');
    if (!resourceType) throw new ApiError(400, 'invalid_request', 'resourceType is required');
    if (!VALID_RESOURCE_TYPES.includes(resourceType)) {
      throw new ApiError(400, 'invalid_request', `resourceType must be one of: ${VALID_RESOURCE_TYPES.join(', ')}`);
    }
    if (value === undefined || value === null || value < 0) {
      throw new ApiError(400, 'invalid_request', 'value must be a non-negative integer');
    }

    const site = await Site.findByPk(parseInt(siteId, 10));
    if (!site) throw new ApiError(404, 'site_not_found', 'Site not found');

    const parsedValue = parseInt(value, 10);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      throw new ApiError(400, 'invalid_request', 'value must be a non-negative integer');
    }

    const username = req.session.user;
    const autoApprove = shouldAutoApprove(req.session.isAdmin, resourceType, parsedValue);

    const request = await ResourceRequest.create({
      siteId: site.id,
      hostname: hostname.trim().toLowerCase(),
      username,
      requestedBy: username,
      resourceType,
      value: parsedValue,
      status: autoApprove ? 'approved' : 'pending',
      comment: comment || null,
      reviewedBy: autoApprove ? (req.session.isAdmin ? username : 'system') : null,
      reviewedAt: autoApprove ? new Date() : null,
    });

    // If auto-approved, apply to any existing matching containers
    if (autoApprove) {
      await applyResourceToExistingContainers(site.id, request.hostname, username, resourceType, parsedValue);
    }

    return created(res, request);
  }),
);

// PUT /:id/approve — admin approves a request
router.put(
  '/:id/approve',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const request = await ResourceRequest.findByPk(parseInt(req.params.id, 10));
    if (!request) throw new ApiError(404, 'not_found', 'Request not found');
    if (request.status !== 'pending') {
      throw new ApiError(409, 'already_reviewed', 'Request has already been reviewed');
    }

    const { adminComment } = req.body || {};

    await request.update({
      status: 'approved',
      reviewedBy: req.session.user,
      reviewedAt: new Date(),
      adminComment: adminComment || null,
    });

    // Apply to existing containers
    await applyResourceToExistingContainers(
      request.siteId,
      request.hostname,
      request.username,
      request.resourceType,
      request.value,
    );

    return ok(res, request);
  }),
);

// PUT /:id/deny — admin denies a request
router.put(
  '/:id/deny',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const request = await ResourceRequest.findByPk(parseInt(req.params.id, 10));
    if (!request) throw new ApiError(404, 'not_found', 'Request not found');
    if (request.status !== 'pending') {
      throw new ApiError(409, 'already_reviewed', 'Request has already been reviewed');
    }

    const { adminComment } = req.body || {};

    await request.update({
      status: 'denied',
      reviewedBy: req.session.user,
      reviewedAt: new Date(),
      adminComment: adminComment || null,
    });

    return ok(res, request);
  }),
);

/**
 * Apply a resource change to existing running containers matching the identity.
 * This creates a reconfigure job for each matching container.
 */
async function applyResourceToExistingContainers(siteId, hostname, username, resourceType, value) {
  const containers = await Container.findAll({
    where: { siteId, hostname, username, status: 'running' },
  });

  if (containers.length === 0) return;

  const { Job } = require('../../../models');
  for (const container of containers) {
    await Job.create({
      command: `node bin/reconfigure-container.js --container-id=${container.id} --${resourceType}=${value}`,
      createdBy: 'system',
      status: 'pending',
    });
  }
}

module.exports = router;
