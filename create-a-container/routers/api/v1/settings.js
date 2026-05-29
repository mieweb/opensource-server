/**
 * /api/v1/settings — admin-only key/value system settings + default container env vars.
 */

const express = require('express');
const { Setting } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, ApiError } = require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth, apiAdmin);

const KEYS = [
  'push_notification_url',
  'push_notification_enabled',
  'push_notification_api_key',
  'smtp_url',
  'smtp_noreply_address',
  'default_container_env_vars',
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
      pushNotificationUrl: settings.push_notification_url || '',
      pushNotificationEnabled: settings.push_notification_enabled === 'true',
      pushNotificationApiKey: settings.push_notification_api_key || '',
      smtpUrl: settings.smtp_url || '',
      smtpNoreplyAddress: settings.smtp_noreply_address || '',
      defaultContainerEnvVars,
    });
  }),
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const {
      pushNotificationUrl,
      pushNotificationEnabled,
      pushNotificationApiKey,
      smtpUrl,
      smtpNoreplyAddress,
      defaultContainerEnvVars,
    } = req.body || {};

    if (pushNotificationEnabled === true && (!pushNotificationUrl || pushNotificationUrl.trim() === '')) {
      throw new ApiError(400, 'invalid_request', 'pushNotificationUrl is required when push notifications are enabled');
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

    await Setting.set('push_notification_url', pushNotificationUrl || '');
    await Setting.set('push_notification_enabled', pushNotificationEnabled ? 'true' : 'false');
    await Setting.set('push_notification_api_key', pushNotificationApiKey || '');
    await Setting.set('smtp_url', smtpUrl || '');
    await Setting.set('smtp_noreply_address', smtpNoreplyAddress || '');
    await Setting.set('default_container_env_vars', JSON.stringify(envVars));

    return ok(res, { saved: true });
  }),
);

module.exports = router;
