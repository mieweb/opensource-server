/**
 * /api/v1/external-domains — admin-only CRUD + per-domain mail enablement.
 * The Cloudflare API key is write-only: never returned in any response.
 * Mail flags are read-only here — they change only via the /mail endpoints.
 */

const express = require('express');
const { ExternalDomain, Site, DkimKey, MailAccount, Setting } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');
const { generateDkimKeyPair } = require('../../../utils/dkim');
const { buildMailDnsRecords, checkMailDns } = require('../../../utils/mail-dns');
const { getMailIp } = require('../../../utils/mail-host');

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
    // Read-only mail state (issue #67) — mutate via the /mail endpoints.
    mailEnabled: d.mailEnabled,
    mailDnsVerified: d.mailDnsVerified,
    mailMxVerified: d.mailMxVerified,
    mailDnsCheckedAt: d.mailDnsCheckedAt,
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
    // Every domain gets a DKIM key at create so the DNS records can be
    // published before mail is ever enabled (existing domains were
    // backfilled by migration 20261008000007).
    await DkimKey.create({ externalDomainId: d.id, ...generateDkimKeyPair() });
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

// ---------------------------------------------------------------------------
// Mail enablement (issue #67). Send gate = mailEnabled && mailDnsVerified;
// receive gate = mailEnabled && mailMxVerified. Re-verification is manual.
// ---------------------------------------------------------------------------

async function loadDomain(id) {
  const d = await ExternalDomain.findByPk(id);
  if (!d) throw new ApiError(404, 'not_found', 'External domain not found');
  return d;
}

/** Everything buildMailDnsRecords/checkMailDns need for one domain. */
async function mailDnsContext(d) {
  const settings = await Setting.getMultiple([
    'mail_hostname', 'mail_spf_include', 'mail_dns_check_resolvers',
  ]);
  const dkimKey = await DkimKey.findOne({
    where: { externalDomainId: d.id, status: 'active' },
    order: [['createdAt', 'DESC']],
  });
  return {
    domain: d.name,
    mailIp: await getMailIp(),
    mailHostname: settings.mail_hostname || null,
    spfInclude: settings.mail_spf_include || null,
    dkimKey: dkimKey ? { selector: dkimKey.selector, publicKey: dkimKey.publicKey } : null,
    resolvers: (settings.mail_dns_check_resolvers || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** Run Check DNS, persist the outcome, and flip the verification gates. */
async function runDnsCheck(d) {
  const context = await mailDnsContext(d);
  const result = await checkMailDns(context);
  const accounts = await MailAccount.findAll({
    where: { externalDomainId: d.id, localPart: ['postmaster', 'abuse'] },
    attributes: ['localPart'],
  });
  for (const role of ['postmaster', 'abuse']) {
    if (!accounts.some((a) => a.localPart === role)) {
      result.warnings.push(`No ${role}@${d.name} mailbox exists yet (admins create role mailboxes).`);
    }
  }
  await d.update({
    mailDnsCheckedAt: new Date(),
    mailDnsCheckResult: result,
    mailDnsVerified: result.spf.pass && result.dkim.pass && result.dmarc.pass,
    mailMxVerified: result.mx.pass,
  });
  return result;
}

router.get(
  '/:id/mail/dns',
  asyncHandler(async (req, res) => {
    const d = await loadDomain(req.params.id);
    const context = await mailDnsContext(d);
    return ok(res, {
      records: buildMailDnsRecords(context),
      mailEnabled: d.mailEnabled,
      mailDnsVerified: d.mailDnsVerified,
      mailMxVerified: d.mailMxVerified,
      lastCheck: d.mailDnsCheckedAt
        ? { checkedAt: d.mailDnsCheckedAt, result: d.mailDnsCheckResult }
        : null,
    });
  }),
);

router.post(
  '/:id/mail/check-dns',
  asyncHandler(async (req, res) => {
    const d = await loadDomain(req.params.id);
    const result = await runDnsCheck(d);
    return ok(res, { ...serialize(d), check: result });
  }),
);

router.post(
  '/:id/mail/enable',
  asyncHandler(async (req, res) => {
    const d = await loadDomain(req.params.id);
    const result = await runDnsCheck(d);
    // SPF/DKIM/DMARC are hard requirements to send; MX failure only means
    // the domain can't receive yet, so it just warns.
    if (!d.mailDnsVerified) {
      throw new ApiError(422, 'dns_not_configured',
        'SPF, DKIM, or DMARC records are missing or wrong — publish the records from GET …/mail/dns and re-check');
    }
    await d.update({ mailEnabled: true });
    return ok(res, { ...serialize(d), check: result });
  }),
);

router.post(
  '/:id/mail/disable',
  asyncHandler(async (req, res) => {
    const d = await loadDomain(req.params.id);
    // Keys and config are kept; accounts stop authenticating immediately
    // because the SQL views gate on mailEnabled.
    await d.update({ mailEnabled: false });
    return ok(res, serialize(d));
  }),
);

module.exports = router;
