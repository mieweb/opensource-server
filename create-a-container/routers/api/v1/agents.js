/**
 * /api/v1/agents — site agent check-in and status.
 *
 * POST /  agent check-in: records system info + service states, responds with
 *         the site's config snapshot (or 304 when the agent's If-None-Match
 *         ETag still matches).
 * GET  /  admin: current status of all agents.
 */

const express = require('express');
const { Agent, Site, Container, Volume } = require('../../../models');
const { apiAuth, apiAdmin, localhostOrAdmin, asyncHandler, ok, fail } = require('../../../middlewares/api');
const { buildAgentConfig, computeConfigEtag } = require('../../../utils/agent-config');

const router = express.Router();

/**
 * Apply an agent-reported per-volume results map to the Volume table, scoped to
 * the checking-in site. Shape: { <volumeId>: { applied: true|false, message? } }.
 * The Manager owns the volume ids (sent in the config snapshot); the agent
 * reports the outcome of its mkdir. Transitions each Volume.status to
 * ready/failed with statusMessage + appliedAt.
 *
 * Each volume is loaded together with its owning container and verified to
 * belong to `siteId` before any update — a check-in from one site (or a
 * misconfigured/rogue agent) must not be able to mark another site's volume
 * ready and let a create job attach an unprovisioned path. Unknown ids,
 * cross-site ids, and built-in volumes are ignored.
 * @param {number} siteId - The checking-in site's id.
 * @param {object} volumesResult
 * @returns {Promise<void>}
 */
async function applyVolumeResults(siteId, volumesResult) {
  if (!volumesResult || typeof volumesResult !== 'object') return;
  for (const [rawId, result] of Object.entries(volumesResult)) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || !result || typeof result !== 'object') continue;
    const volume = await Volume.findByPk(id, {
      include: [{ model: Container, as: 'container', attributes: ['id', 'siteId'] }],
    });
    // Skip unknown ids, built-in (admin-provisioned, not agent-owned) volumes,
    // and — critically — any volume whose container is not in this site.
    if (!volume || volume.builtin) continue;
    if (!volume.container || volume.container.siteId !== siteId) continue;
    const applied = result.applied === true || result.applied === 'true';
    const message = typeof result.message === 'string' ? result.message.slice(0, 2000) : null;
    if (applied) {
      await volume.update({ status: 'ready', statusMessage: null, appliedAt: new Date() });
    } else {
      await volume.update({ status: 'failed', statusMessage: message || 'agent reported failure' });
    }
  }
}

router.post('/', localhostOrAdmin, asyncHandler(async (req, res) => {
  const { siteId, hostname, ipv4Address, services, volumes } = req.body || {};
  const parsedSiteId = typeof siteId === 'number' ? siteId : Number(siteId);
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
    // Transition Volume.status from the agent's per-volume directory results,
    // scoped to this site so a check-in can't touch another site's volumes.
    await applyVolumeResults(parsedSiteId, volumes);
  }

  const config = await buildAgentConfig(parsedSiteId);
  // Manual conditional-request handling: Express's built-in ETag/fresh logic
  // (res.send + req.fresh) only produces 304s for GET/HEAD, and the check-in
  // is a POST.
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
    // Computed server-side so UI staleness judgments don't depend on the
    // client's clock.
    secondsSinceCheckin: a.lastCheckinAt
      ? Math.max(0, Math.round((now - new Date(a.lastCheckinAt).getTime()) / 1000))
      : null,
  })));
}));

module.exports = router;
