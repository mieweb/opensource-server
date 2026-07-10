/**
 * /api/v1/sites — site CRUD + nested resource pointers.
 * Nested containers/nodes/jobs are mounted under /api/v1/sites/:siteId/* via this router.
 */

const express = require('express');
const { Site, Node } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth);

// Nested mounts
router.use('/:siteId/containers', require('./containers'));
router.use('/:siteId/nodes', require('./nodes'));

function serialize(site) {
  return {
    id: site.id,
    name: site.name,
    internalDomain: site.internalDomain,
    dhcpRange: site.dhcpRange,
    subnetMask: site.subnetMask,
    gateway: site.gateway,
    dnsForwarders: site.dnsForwarders,
    externalIp: site.externalIp,
    nodeCount: site.nodes ? site.nodes.length : undefined,
  };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const sites = await Site.findAll({
      include: [{ model: Node, as: 'nodes', attributes: ['id', 'name'] }],
      order: [['id', 'ASC']],
    });
    return ok(res, sites.map(serialize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const site = await Site.findByPk(req.params.id, {
      include: [{ model: Node, as: 'nodes', attributes: ['id', 'name'] }],
    });
    if (!site) throw new ApiError(404, 'not_found', 'Site not found');
    return ok(res, serialize(site));
  }),
);

router.post(
  '/',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders, externalIp } =
      req.body || {};
    const site = await Site.create({
      name,
      internalDomain,
      dhcpRange,
      subnetMask,
      gateway,
      dnsForwarders,
      externalIp: externalIp || null,
    });
    return created(res, serialize(site));
  }),
);

router.put(
  '/:id',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const site = await Site.findByPk(req.params.id);
    if (!site) throw new ApiError(404, 'not_found', 'Site not found');
    const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders, externalIp } =
      req.body || {};
    await site.update({
      name,
      internalDomain,
      dhcpRange,
      subnetMask,
      gateway,
      dnsForwarders,
      externalIp: externalIp || null,
    });
    return ok(res, serialize(site));
  }),
);

router.delete(
  '/:id',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const site = await Site.findByPk(req.params.id, {
      include: [{ model: Node, as: 'nodes' }],
    });
    if (!site) throw new ApiError(404, 'not_found', 'Site not found');
    if (site.nodes && site.nodes.length > 0) {
      throw new ApiError(409, 'has_nodes', 'Cannot delete site with associated nodes');
    }
    await site.destroy();
    return noContent(res);
  }),
);

module.exports = router;
