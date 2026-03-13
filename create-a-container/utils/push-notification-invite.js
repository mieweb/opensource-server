const { Setting } = require('../models');

/**
 * Send a 2FA invite request to the push notification service.
 * Returns null when URL/API key are not configured (caller should skip silently).
 * @param {Object} user - User data with mail, uid, givenName, sn fields
 * @returns {Promise<{success: boolean, inviteUrl?: string, expiresAt?: string, error?: string}|null>}
 */
async function sendPushNotificationInvite(user) {
  const settings = await Setting.getMultiple([
    'push_notification_url',
    'push_notification_api_key'
  ]);

  const url = settings.push_notification_url?.trim();
  const apiKey = settings.push_notification_api_key?.trim();

  if (!url || !apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${url}/api/invite`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.mail,
        username: user.uid,
        firstName: user.givenName,
        lastName: user.sn
      })
    });

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.status === 201 && body?.success) {
      return {
        success: true,
        inviteUrl: body.inviteUrl,
        expiresAt: body.expiresAt
      };
    }

    const errorMessage = body?.error || `2FA invite failed (HTTP ${response.status})`;
    return { success: false, error: errorMessage };
  } catch (err) {
    return { success: false, error: '2FA invite service unreachable' };
  }
}

module.exports = { sendPushNotificationInvite };
