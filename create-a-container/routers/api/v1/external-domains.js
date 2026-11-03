/**
 * /api/v1/external-domains — admin-only CRUD + per-domain mail enablement.
 * The Cloudflare API key is write-only: never returned in any response.
 * mailEnabled toggles via PATCH /:id; the verification flags are read-only
 * (they change only via POST /:id/mail/check-dns, and reset when the domain
 * is renamed — the saved result belongs to the old name).
 */

const express = require('express');
const { ExternalDomain, Site, DkimKey, MailAccount, Setting, sequelize } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');
const { generateDkimKeyPair } = require('../../../utils/dkim');
const { buildMailDnsRecords, checkMailDns } = require('../../../utils/mail-dns');
const { getMailIp } = require('../../../utils/mail-host');

const router = express.Router();

router.use(apiAuth, apiAdmin);

// Renaming invalidates DNS verification — SPF/DKIM/DMARC/MX were checked
// against the old name, so the new name must be re-verified.
const MAIL_VERIFICATION_RESET = {
  mailDnsVerified: false,
  mailMxVerified: false,
  mailDnsCheckedAt: null,
  mailDnsCheckResult: null,
};

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
    // Read-only mail verification state (issue #67) — refreshed by
    // POST /:id/mail/check-dns; mailEnabled toggles via PATCH /:id.
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
    // Every domain gets a DKIM key at create so the DNS records can be
    // published before mail is ever enabled (existing domains were
    // backfilled by migration 20261008000007). One transaction — a failed
    // key insert must not leave a keyless domain behind.
    const d = await sequelize.transaction(async (transaction) => {
      const domain = await ExternalDomain.create({
        name,
        acmeEmail: acmeEmail || null,
        acmeDirectoryUrl: acmeDirectoryUrl || null,
        cloudflareApiEmail: cloudflareApiEmail || null,
        cloudflareApiKey: cloudflareApiKey || null,
        siteId: siteId || null,
        authServer: authServer || null,
      }, { transaction });
      await DkimKey.create({ externalDomainId: domain.id, ...generateDkimKeyPair() }, { transaction });
      return domain;
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
    if (name !== undefined && name !== d.name) {
      Object.assign(update, MAIL_VERIFICATION_RESET);
    }
    await d.update(update);
    return ok(res, serialize(d));
  }),
);

// Partial update. `mailEnabled` is the mail on/off switch (issue #67):
// enabling runs Check DNS and requires the send gate (SPF + DKIM + DMARC);
// disabling keeps keys and config — accounts stop authenticating immediately
// because the SQL views gate on mailEnabled.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = await loadDomain(req.params.id);
    const body = req.body || {};

    const update = {};
    if (body.name !== undefined) update.name = body.name;
    for (const f of ['acmeEmail', 'acmeDirectoryUrl', 'cloudflareApiEmail', 'siteId', 'authServer']) {
      if (body[f] !== undefined) update[f] = body[f] || null;
    }
    if (body.cloudflareApiKey && body.cloudflareApiKey.trim() !== '') {
      update.cloudflareApiKey = body.cloudflareApiKey;
    }

    const renaming = update.name !== undefined && update.name !== d.name;
    if (renaming) Object.assign(update, MAIL_VERIFICATION_RESET);

    let check;
    if (body.mailEnabled === true) {
      // Check the name being saved — a rename must not enable mail using the
      // old name's DNS result.
      check = await runDnsCheck(d, renaming ? update.name : d.name);
      const checkFields = dnsCheckFields(check);
      if (!checkFields.mailDnsVerified) {
        // Record the failed check unless it ran against a name that is
        // not being saved (the 422 aborts the rename).
        if (!renaming) await d.update(checkFields);
        throw new ApiError(422, 'dns_not_configured',
          'SPF, DKIM, or DMARC records are missing or wrong — publish the records from GET …/mail/dns and re-check');
      }
      Object.assign(update, checkFields, { mailEnabled: true });
    } else if (body.mailEnabled === false) {
      update.mailEnabled = false;
    }

    await d.update(update);
    return ok(res, check ? { ...serialize(d), check } : serialize(d));
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
async function mailDnsContext(d, name = d.name) {
  const settings = await Setting.getMultiple([
    'mail_hostname', 'mail_spf_include', 'mail_dns_check_resolvers',
  ]);
  const dkimKey = await DkimKey.findOne({
    where: { externalDomainId: d.id, status: 'active' },
    order: [['createdAt', 'DESC']],
  });
  return {
    domain: name,
    mailIp: await getMailIp(),
    mailHostname: settings.mail_hostname || null,
    spfInclude: settings.mail_spf_include || null,
    dkimKey: dkimKey ? { selector: dkimKey.selector, publicKey: dkimKey.publicKey } : null,
    resolvers: (settings.mail_dns_check_resolvers || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** Run Check DNS for `name` (defaults to the saved name) and return the
 *  result — persist it with dnsCheckFields(). */
async function runDnsCheck(d, name = d.name) {
  const context = await mailDnsContext(d, name);
  const result = await checkMailDns(context);
  const accounts = await MailAccount.findAll({
    where: { externalDomainId: d.id, localPart: ['postmaster', 'abuse'] },
    attributes: ['localPart'],
  });
  for (const role of ['postmaster', 'abuse']) {
    if (!accounts.some((a) => a.localPart === role)) {
      result.warnings.push(`No ${role}@${name} mailbox exists yet (admins create role mailboxes).`);
    }
  }
  return result;
}

/** Verification gate fields derived from one Check DNS result. */
function dnsCheckFields(result) {
  return {
    mailDnsCheckedAt: new Date(),
    mailDnsCheckResult: result,
    mailDnsVerified: result.spf.pass && result.dkim.pass && result.dmarc.pass,
    mailMxVerified: result.mx.pass,
  };
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
    await d.update(dnsCheckFields(result));
    return ok(res, { ...serialize(d), check: result });
  }),
);

// Self-managed MTA export: the active DKIM private key. Deliberately noisy
// in the logs — private-key reads should be rare, intentional events.
router.get(
  '/:id/mail/dkim',
  asyncHandler(async (req, res) => {
    const d = await loadDomain(req.params.id);
    const key = await DkimKey.findOne({
      where: { externalDomainId: d.id, status: 'active' },
      order: [['createdAt', 'DESC']],
    });
    if (!key) throw new ApiError(404, 'not_found', 'No active DKIM key for this domain');
    console.warn(`AUDIT: DKIM private key for ${d.name} exported by admin [redacted]`);
    return ok(res, {
      domain: d.name,
      selector: key.selector,
      privateKey: key.privateKey,
      publicKey: key.publicKey,
    });
  }),
);

module.exports = router;
