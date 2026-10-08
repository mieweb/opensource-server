/**
 * /api/v1/mail — admin mail-host management (issue #67).
 *
 * GET  /host          who holds the mail-host claim + the mail IP
 * POST /host/release  release the claim (next qualifying check-in takes it)
 * GET  /ptr           PTR suggestion for the mail_hostname setting
 */

const express = require('express');
const { Setting } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok } = require('../../../middlewares/api');
const { getMailHostAgent, getMailIp, releaseMailHost } = require('../../../utils/mail-host');
const { lookupPtr } = require('../../../utils/mail-dns');

const router = express.Router();

router.use(apiAuth, apiAdmin);

router.get(
  '/host',
  asyncHandler(async (_req, res) => {
    const holder = await getMailHostAgent();
    const settings = await Setting.getMultiple(['mail_hostname', 'mail_self_managed_site_id']);
    return ok(res, {
      agent: holder
        ? {
          id: holder.id,
          siteId: holder.siteId,
          siteName: holder.site?.name || null,
          hostname: holder.hostname,
          mailHostSince: holder.mailHostSince,
          enabledServices: holder.enabledServices,
          missingBinaries: holder.missingBinaries,
        }
        : null,
      mailIp: await getMailIp(),
      mailHostname: settings.mail_hostname || null,
      selfManagedSiteId: parseInt(settings.mail_self_managed_site_id, 10) || null,
    });
  }),
);

router.post(
  '/host/release',
  asyncHandler(async (_req, res) => {
    const released = await releaseMailHost();
    return ok(res, { released: !!released });
  }),
);

router.get(
  '/ptr',
  asyncHandler(async (_req, res) => {
    const mailIp = await getMailIp();
    const settings = await Setting.getMultiple(['mail_hostname', 'mail_dns_check_resolvers']);
    const resolvers = (settings.mail_dns_check_resolvers || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const ptr = mailIp ? await lookupPtr({ ip: mailIp, resolvers }) : { name: null, forwardConfirmed: false };
    return ok(res, {
      mailIp,
      ptr: ptr.name,
      forwardConfirmed: ptr.forwardConfirmed,
      mailHostname: settings.mail_hostname || null,
      // Suggest the forward-confirmed PTR name as mail_hostname.
      suggestion: ptr.forwardConfirmed ? ptr.name : null,
    });
  }),
);

module.exports = router;
