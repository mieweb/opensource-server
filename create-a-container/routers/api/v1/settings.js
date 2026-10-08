/**
 * /api/v1/settings — admin-only key/value system settings + default container env vars.
 */

const express = require('express');
const { Setting } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, fail } = require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth, apiAdmin);

const KEYS = [
  'smtp_url',
  'smtp_noreply_address',
  'default_container_env_vars',
  'netbox_url',
  'netbox_token',
  'banner_message',
  'usage_psi_probe_limit',
  // Mail service (issue #67)
  'mail_hostname',
  'mail_unsubscribe_base_url',
  'mail_relayhost',
  'mail_relayhost_username',
  'mail_relayhost_password',
  'mail_spf_include',
  'mail_dns_check_resolvers',
  'mail_db_host',
  'mail_self_managed_site_id',
  'mail_default_quota_mb',
  'mail_message_size_limit_mb',
];

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await Setting.getMultiple(KEYS);
    let defaultContainerEnvVars = [];
    try {
      defaultContainerEnvVars = await Setting.getDefaultContainerEnvVars();
    } catch {
      /* malformed JSON — treat as empty */
    }
    return ok(res, {
      smtpUrl: settings.smtp_url || '',
      smtpNoreplyAddress: settings.smtp_noreply_address || '',
      defaultContainerEnvVars,
      netboxUrl: settings.netbox_url || '',
      netboxToken: settings.netbox_token || '',
      bannerMessage: settings.banner_message || '',
      usagePsiProbeLimit: settings.usage_psi_probe_limit || '',
      mailHostname: settings.mail_hostname || '',
      mailUnsubscribeBaseUrl: settings.mail_unsubscribe_base_url || '',
      mailRelayhost: settings.mail_relayhost || '',
      mailRelayhostUsername: settings.mail_relayhost_username || '',
      mailRelayhostPassword: settings.mail_relayhost_password || '',
      mailSpfInclude: settings.mail_spf_include || '',
      mailDnsCheckResolvers: settings.mail_dns_check_resolvers || '',
      mailDbHost: settings.mail_db_host || '',
      mailSelfManagedSiteId: settings.mail_self_managed_site_id || '',
      mailDefaultQuotaMb: settings.mail_default_quota_mb || '',
      mailMessageSizeLimitMb: settings.mail_message_size_limit_mb || '',
    });
  }),
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const {
      smtpUrl,
      smtpNoreplyAddress,
      defaultContainerEnvVars,
      netboxUrl,
      netboxToken,
      bannerMessage,
      usagePsiProbeLimit,
      mailHostname,
      mailUnsubscribeBaseUrl,
      mailRelayhost,
      mailRelayhostUsername,
      mailRelayhostPassword,
      mailSpfInclude,
      mailDnsCheckResolvers,
      mailDbHost,
      mailSelfManagedSiteId,
      mailDefaultQuotaMb,
      mailMessageSizeLimitMb,
    } = req.body || {};

    // A relayhost sends from the relay's IPs, so SPF must delegate to it.
    if ((mailRelayhost || '').trim() && !(mailSpfInclude || '').trim()) {
      return fail(res, 422, 'validation_failed', 'mailSpfInclude is required when a relayhost is set');
    }

    const envVars = [];
    if (Array.isArray(defaultContainerEnvVars)) {
      for (const e of defaultContainerEnvVars) {
        if (e && e.key && e.key.trim()) {
          envVars.push({
            key: e.key.trim(),
            value: e.value || '',
            description: e.description || '',
          });
        }
      }
    }

    await Setting.set('smtp_url', smtpUrl || '');
    await Setting.set('smtp_noreply_address', smtpNoreplyAddress || '');
    await Setting.set('default_container_env_vars', JSON.stringify(envVars));
    await Setting.set('netbox_url', netboxUrl || '');
    await Setting.set('netbox_token', netboxToken || '');
    await Setting.set('banner_message', (bannerMessage || '').trim());
    // Store a clean non-negative integer, or '' to fall back to the default.
    const psiParsed = parseInt(String(usagePsiProbeLimit ?? '').trim(), 10);
    await Setting.set(
      'usage_psi_probe_limit',
      Number.isNaN(psiParsed) || psiParsed < 0 ? '' : String(psiParsed),
    );

    const positiveIntOrEmpty = (value) => {
      const n = parseInt(String(value ?? '').trim(), 10);
      return Number.isNaN(n) || n < 1 ? '' : String(n);
    };
    await Setting.set('mail_hostname', (mailHostname || '').trim());
    await Setting.set('mail_unsubscribe_base_url', (mailUnsubscribeBaseUrl || '').trim().replace(/\/+$/, ''));
    await Setting.set('mail_relayhost', (mailRelayhost || '').trim());
    await Setting.set('mail_relayhost_username', (mailRelayhostUsername || '').trim());
    await Setting.set('mail_relayhost_password', mailRelayhostPassword || '');
    await Setting.set('mail_spf_include', (mailSpfInclude || '').trim());
    await Setting.set('mail_dns_check_resolvers', (mailDnsCheckResolvers || '').trim());
    await Setting.set('mail_db_host', (mailDbHost || '').trim());
    await Setting.set('mail_self_managed_site_id', positiveIntOrEmpty(mailSelfManagedSiteId));
    await Setting.set('mail_default_quota_mb', positiveIntOrEmpty(mailDefaultQuotaMb));
    await Setting.set('mail_message_size_limit_mb', positiveIntOrEmpty(mailMessageSizeLimitMb));

    return ok(res, { saved: true });
  }),
);

module.exports = router;
