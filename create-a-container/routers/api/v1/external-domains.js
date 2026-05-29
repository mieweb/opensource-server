/**
 * /api/v1/external-domains — admin-only CRUD.
 * The Cloudflare API key is write-only: never returned in any response.
 */

const express = require('express');
const { ExternalDomain, Site } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth, apiAdmin);

function serialize(d) {
  return {
    id: d.id,
    name: d.name,
    acmeEmail: d.acmeEmail,
    acmeDirectoryUrl: d.acmeDirectoryUrl,
    cloudflareApiEmail: d.cloudflareApiEmail,
    siteId: d.siteId,
    site: d.site ? { id: d.site.id, name: d.site.name } : null,
    authServer: d.authServer,
    hasCloudflareApiKey: !!d.cloudflareApiKey,
  };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await ExternalDomain.findAll({
      include: [{ model: Site, as: 'site', attributes: ['id', 'name'], required: false }],
      order: [['name', 'ASC']],
    });
    return ok(res, rows.map(serialize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = await ExternalDomain.findByPk(req.params.id, {
      include: [{ model: Site, as: 'site', attributes: ['id', 'name'], required: false }],
    });
    if (!d) throw new ApiError(404, 'not_found', 'External domain not found');
    return ok(res, serialize(d));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId, authServer } =
      req.body || {};
    const d = await ExternalDomain.create({
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null,
      cloudflareApiKey: cloudflareApiKey || null,
      siteId: siteId || null,
      authServer: authServer || null,
    });
    return created(res, serialize(d));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = await ExternalDomain.findByPk(req.params.id);
    if (!d) throw new ApiError(404, 'not_found', 'External domain not found');
    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId, authServer } =
      req.body || {};
    const update = {
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null,
      siteId: siteId || null,
      authServer: authServer || null,
    };
    if (cloudflareApiKey && cloudflareApiKey.trim() !== '') {
      update.cloudflareApiKey = cloudflareApiKey;
    }
    await d.update(update);
    return ok(res, serialize(d));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = await ExternalDomain.findByPk(req.params.id);
    if (!d) throw new ApiError(404, 'not_found', 'External domain not found');
    await d.destroy();
    return noContent(res);
  }),
);

module.exports = router;
