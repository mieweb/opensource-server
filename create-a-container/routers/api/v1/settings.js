/**
 * /api/v1/settings — admin-only key/value system settings + default container env vars.
 */

const express = require('express');
const { Setting } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok } = require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth, apiAdmin);

const KEYS = [
  'smtp_url',
  'smtp_noreply_address',
  'default_container_env_vars',
  'netbox_url',
  'netbox_token',
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
    } = req.body || {};

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

    return ok(res, { saved: true });
  }),
);

module.exports = router;
