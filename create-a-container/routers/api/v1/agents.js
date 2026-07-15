/**
 * /api/v1/agents — site agent check-in and status.
 *
 * POST /  agent check-in: records system info + service states, responds with
 *         the site's config snapshot (or 304 when the agent's If-None-Match
 *         ETag still matches).
 * GET  /  admin: current status of all agents.
 */

const express = require('express');
const { Agent, Site } = require('../../../models');
const { isLocalhostRequest } = require('../../../middlewares');
const { apiAuth, apiAdmin, asyncHandler, ok, fail } = require('../../../middlewares/api');
const { buildAgentConfig, computeConfigEtag } = require('../../../utils/agent-config');

const router = express.Router();

// An agent is online if it checked in within three 30-second timer intervals.
const ONLINE_WINDOW_MS = 90 * 1000;

// The manager's own agent checks in over localhost without credentials
// (bootstrap: no site, no API key exist yet). Remote agents authenticate
// with an admin API key.
function agentAuth(req, res, next) {
  if (isLocalhostRequest(req)) return next();
  return apiAuth(req, res, (err) => {
    if (err) return next(err);
    return apiAdmin(req, res, next);
  });
}

router.post('/', agentAuth, asyncHandler(async (req, res) => {
  const { siteId, hostname, ipv4Address, services } = req.body || {};
  const parsedSiteId = parseInt(siteId, 10);
  if (!Number.isInteger(parsedSiteId) || !hostname || typeof hostname !== 'string') {
    return fail(res, 422, 'validation_failed', 'siteId and hostname are required');
  }

  // Record the check-in. Skipped during bootstrap (the site row doesn't exist
  // yet) since the foreign key has nothing to point at.
  const site = await Site.findByPk(parsedSiteId);
  if (site) {
    const [agent] = await Agent.findOrCreate({
      where: { siteId: parsedSiteId, hostname },
    });
    await agent.update({
      ipv4Address: ipv4Address || null,
      services: services || null,
      lastCheckinAt: new Date(),
    });
  }

  const config = await buildAgentConfig(parsedSiteId);
  const etag = computeConfigEtag(config);
  res.set('ETag', etag);
  if (req.get('If-None-Match') === etag) {
    return res.status(304).end();
  }
  return ok(res, config);
}));

router.get('/', apiAuth, apiAdmin, asyncHandler(async (req, res) => {
  const agents = await Agent.findAll({
    include: [{ model: Site, as: 'site', attributes: ['id', 'name'] }],
    order: [['siteId', 'ASC'], ['hostname', 'ASC']],
  });
  const now = Date.now();
  return ok(res, agents.map((a) => ({
    id: a.id,
    siteId: a.siteId,
    siteName: a.site?.name || null,
    hostname: a.hostname,
    ipv4Address: a.ipv4Address,
    services: a.services,
    lastCheckinAt: a.lastCheckinAt,
    online: !!a.lastCheckinAt && now - new Date(a.lastCheckinAt).getTime() <= ONLINE_WINDOW_MS,
  })));
}));

module.exports = router;
