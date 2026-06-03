/**
 * /api/v1/auth — login, logout, register, password reset, 2FA polling.
 *
 * Login flow:
 *   1. POST /login { username, password }
 *      → 200 { data: { user, isAdmin } }                  // no 2FA configured, logged in
 *      → 200 { data: { challengeId, requires2FA: true } } // push 2FA enqueued
 *      → 401 { error }                                    // bad credentials
 *   2. GET  /login/challenge/:id  (poll)
 *      → 200 { data: { status: 'pending' } }
 *      → 200 { data: { status: 'approved', user, isAdmin } } (session now active)
 *      → 200 { data: { status: 'rejected' | 'timeout' | 'failed', message } }
 */

const express = require('express');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const {
  User,
  Group,
  Setting,
  Site,
  Node,
  ExternalDomain,
  PasswordResetToken,
  InviteToken,
} = require('../../../models');
const { sendPasswordResetEmail } = require('../../../utils/email');
const { sendPushNotificationInvite } = require('../../../utils/push-notification-invite');
const { isSafeRedirectUrl } = require('../../../utils');
const { asyncHandler, ok, created, ApiError } = require('../../../middlewares/api');

const router = express.Router();

// In-memory challenge store for 2FA flows.
// Keyed by challengeId; values expire after 5 minutes.
const challenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
function newChallengeId() {
  return require('crypto').randomBytes(16).toString('hex');
}
function setChallenge(id, value) {
  challenges.set(id, value);
  setTimeout(() => challenges.delete(id), CHALLENGE_TTL_MS).unref?.();
}

async function safeRedirectUrl(redirect) {
  let url = redirect || '/';
  const domains = await ExternalDomain.findAll({ attributes: ['name'] });
  const allowed = domains.map((d) => d.name);
  return isSafeRedirectUrl(url, allowed) ? url : '/';
}

async function activateSession(req, user) {
  req.session.user = user.uid;
  req.session.isAdmin = user.groups?.some((g) => g.isAdmin) || false;
  await new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
}

// POST /api/v1/auth/dev — One-click dev login (non-production only).
// Creates `dev-admin` or `dev-user` on first use and starts an authenticated
// session. The route is not registered at all when NODE_ENV === 'production'
// so it cannot be reached even by misconfiguration.
if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/dev',
    asyncHandler(async (req, res) => {
      const isAdmin = req.body?.role === 'admin';
      const uid = isAdmin ? 'dev-admin' : 'dev-user';

      // Ensure a localhost site exists to work with.
      const [site] = await Site.findOrCreate({
        where: { name: 'localhost' },
        defaults: { internalDomain: 'localhost', externalIp: '127.0.0.1' },
      });

      // Ensure a local dev node exists so containers can be created without
      // a real Proxmox host. `apiUrl: 'local'` marks it as the mock node;
      // container creation short-circuits provisioning for it in dev.
      await Node.findOrCreate({
        where: { siteId: site.id, apiUrl: 'local' },
        defaults: { name: 'local', tokenId: 'local', secret: 'local', ipv4Address: '127.0.0.1' },
      });

      // Ensure a default external domain exists so HTTP services (added
      // automatically by image templates) have a domain to bind to. Without
      // this the new-container form is unsubmittable for any image that
      // exposes an HTTP port.
      await ExternalDomain.findOrCreate({
        where: { name: 'localhost' },
        defaults: { siteId: site.id },
      });

      let user = await User.findOne({
        where: { uid },
        include: [{ association: 'groups' }],
      });

      if (!user) {
        user = await User.create({
          uidNumber: await User.nextUidNumber(),
          uid,
          givenName: 'Dev',
          sn: isAdmin ? 'Admin' : 'User',
          cn: isAdmin ? 'Dev Admin' : 'Dev User',
          mail: `${uid}@localhost`,
          userPassword: 'dev-password-not-used',
          status: 'active',
          homeDirectory: `/home/${uid}`,
        });

        // The User afterCreate hook auto-adds the first user to sysadmins.
        // Force group membership to match the requested role.
        const adminGroup = await Group.findByPk(2000);
        if (adminGroup) {
          if (isAdmin) await user.addGroup(adminGroup);
          else await user.removeGroup(adminGroup);
        }

        user = await User.findOne({
          where: { uid },
          include: [{ association: 'groups' }],
        });
      }

      await activateSession(req, user);
      return ok(res, {
        user: user.uid,
        isAdmin: req.session.isAdmin,
        redirect: '/',
      });
    }),
  );
}

// POST /api/v1/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password, redirect } = req.body || {};
    if (!username || !password) {
      throw new ApiError(400, 'invalid_request', 'username and password are required');
    }

    const user = await User.findOne({
      where: { uid: username },
      include: [{ association: 'groups' }],
    });
    if (!user || !(await user.validatePassword(password))) {
      throw new ApiError(401, 'invalid_credentials', 'Invalid username or password');
    }
    if (user.status !== 'active') {
      throw new ApiError(403, 'account_inactive', 'Account is not active. Contact an administrator.');
    }

    const settings = await Setting.getMultiple([
      'push_notification_url',
      'push_notification_enabled',
    ]);
    const pushEnabled =
      settings.push_notification_enabled === 'true' &&
      (settings.push_notification_url || '').trim() !== '';

    const safeRedirect = await safeRedirectUrl(redirect);

    if (!pushEnabled) {
      await activateSession(req, user);
      return ok(res, {
        user: user.uid,
        isAdmin: req.session.isAdmin,
        redirect: safeRedirect,
      });
    }

    // 2FA push challenge — start it in the background; client polls /login/challenge/:id.
    const challengeId = newChallengeId();
    setChallenge(challengeId, { status: 'pending', userId: user.uidNumber, redirect: safeRedirect });

    (async () => {
      try {
        const payload = {
          username: user.uid,
          title: 'Authentication Request',
          body: 'Please review and respond to your pending authentication request.',
          actions: [
            { icon: 'approve', title: 'Approve', callback: 'approve' },
            { icon: 'reject', title: 'Reject', callback: 'reject' },
          ],
        };
        const response = await fetch(`${settings.push_notification_url}/send-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));

        if (
          result.success === false &&
          (result.error?.includes('No device found with this Username') ||
            result.error?.includes('User not found'))
        ) {
          setChallenge(challengeId, {
            status: 'unregistered',
            registrationUrl: settings.push_notification_url,
          });
          return;
        }
        if (!response.ok) {
          setChallenge(challengeId, { status: 'failed', message: 'Push notification send failed' });
          return;
        }
        if (result.action === 'approve') {
          setChallenge(challengeId, {
            status: 'approved',
            userId: user.uidNumber,
            redirect: safeRedirect,
          });
        } else if (result.action === 'reject') {
          setChallenge(challengeId, { status: 'rejected', message: 'Second factor denied' });
        } else if (result.action === 'timeout') {
          setChallenge(challengeId, { status: 'timeout', message: 'Second factor timed out' });
        } else {
          setChallenge(challengeId, {
            status: 'failed',
            message: `Second factor failed: ${result.action || 'unknown'}`,
          });
        }
      } catch (err) {
        console.error('2FA push error:', err);
        setChallenge(challengeId, { status: 'failed', message: 'Push notification error' });
      }
    })();

    return ok(res, { challengeId, requires2FA: true });
  }),
);

// GET /api/v1/auth/login/challenge/:id
router.get(
  '/login/challenge/:id',
  asyncHandler(async (req, res) => {
    const ch = challenges.get(req.params.id);
    if (!ch) throw new ApiError(404, 'challenge_not_found', 'Challenge expired or not found');
    if (ch.status === 'approved') {
      const user = await User.findByPk(ch.userId, { include: [{ association: 'groups' }] });
      if (!user) throw new ApiError(500, 'user_missing', 'User no longer exists');
      await activateSession(req, user);
      challenges.delete(req.params.id);
      return ok(res, {
        status: 'approved',
        user: user.uid,
        isAdmin: req.session.isAdmin,
        redirect: ch.redirect || '/',
      });
    }
    return ok(res, { status: ch.status, message: ch.message, registrationUrl: ch.registrationUrl });
  }),
);

// POST /api/v1/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await new Promise((resolve) =>
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        resolve();
      }),
    );
    return ok(res, { loggedOut: true });
  }),
);

// GET /api/v1/auth/register/invite/:token — pre-fill data for invitation token
router.get(
  '/register/invite/:token',
  asyncHandler(async (req, res) => {
    const invite = await InviteToken.validateToken(req.params.token);
    if (!invite) throw new ApiError(404, 'invalid_invite', 'Invalid or expired invitation');
    return ok(res, { email: invite.email });
  }),
);

// POST /api/v1/auth/register
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { uid, givenName: rawGiven, sn: rawSn, mail, userPassword, inviteToken } = req.body || {};
    if (!uid || !rawGiven || !rawSn || !mail || !userPassword) {
      throw new ApiError(400, 'invalid_request', 'All registration fields are required');
    }

    let isInvitedUser = false;
    let validatedInvite = null;
    if (inviteToken) {
      validatedInvite = await InviteToken.validateToken(inviteToken);
      if (!validatedInvite) {
        throw new ApiError(400, 'invalid_invite', 'Invalid or expired invitation link');
      }
      if (mail.toLowerCase().trim() !== validatedInvite.email) {
        throw new ApiError(400, 'email_mismatch', 'Email does not match the invitation');
      }
      isInvitedUser = true;
    }

    let status;
    if ((await User.count()) === 0) status = 'active';
    else if (isInvitedUser) status = 'active';
    else status = 'pending';

    const givenName = rawGiven.trim();
    const sn = rawSn.trim();
    const userParams = {
      uidNumber: await User.nextUidNumber(),
      uid,
      sn,
      givenName,
      mail,
      userPassword,
      status,
      cn: `${givenName} ${sn}`,
      homeDirectory: `/home/${uid}`,
    };

    await User.create(userParams);
    if (validatedInvite) await validatedInvite.markAsUsed();

    let twoFactor = null;
    if (isInvitedUser) {
      const inviteResult = await sendPushNotificationInvite(userParams);
      if (inviteResult?.success && inviteResult.inviteUrl) {
        try {
          const parsed = new URL(inviteResult.inviteUrl);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            const tk = parsed.searchParams.get('token');
            if (tk) twoFactor = { enrollmentToken: tk };
          }
        } catch {
          /* invalid URL */
        }
      } else if (inviteResult?.error) {
        twoFactor = { warning: inviteResult.error };
      }
    }
    return created(res, {
      uid,
      status,
      message: isInvitedUser
        ? 'Account created. You can now log in.'
        : 'Account registered. You will be notified once approved.',
      ...(twoFactor ? { twoFactor } : {}),
    });
  }),
);

// GET /api/v1/auth/register/2fa-qr/:token — produces a QR code for the push-notification enrollment URL
router.get(
  '/register/2fa-qr/:token',
  asyncHandler(async (req, res) => {
    const notificationUrl = await Setting.get('push_notification_url');
    if (!notificationUrl?.trim()) {
      throw new ApiError(404, 'push_not_configured', 'Push notifications are not configured');
    }
    const url = `${notificationUrl.trim()}/register?token=${encodeURIComponent(req.params.token)}`;
    const qrCodeDataUri = await QRCode.toDataURL(url, { width: 256 });
    return ok(res, { qrCodeDataUri, inviteUrl: url });
  }),
);

// POST /api/v1/auth/password-reset/request
router.post(
  '/password-reset/request',
  asyncHandler(async (req, res) => {
    const { usernameOrEmail } = req.body || {};
    if (!usernameOrEmail || usernameOrEmail.trim() === '') {
      throw new ApiError(400, 'invalid_request', 'usernameOrEmail is required');
    }
    const target = usernameOrEmail.trim();
    const user = await User.findOne({
      where: { [Op.or]: [{ uid: target }, { mail: target }] },
    });
    // Do not reveal whether the user exists.
    if (user) {
      const { token } = await PasswordResetToken.generateToken(user.uidNumber);
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
      try {
        await sendPasswordResetEmail(user.mail, user.uid, resetUrl);
      } catch (err) {
        console.error('Password reset email failed:', err);
        // Fall through to generic OK to avoid disclosing detail.
      }
    }
    return ok(res, {
      message: 'If the account exists, reset instructions have been sent.',
    });
  }),
);

// GET /api/v1/auth/password-reset/:token — validate a token (returns username)
router.get(
  '/password-reset/:token',
  asyncHandler(async (req, res) => {
    const token = await PasswordResetToken.validateToken(req.params.token);
    if (!token) throw new ApiError(404, 'invalid_token', 'Invalid or expired reset link');
    return ok(res, { username: token.user.uid });
  }),
);

// POST /api/v1/auth/password-reset/:token — set the new password
router.post(
  '/password-reset/:token',
  asyncHandler(async (req, res) => {
    const { password, confirmPassword } = req.body || {};
    if (!password || !confirmPassword) {
      throw new ApiError(400, 'invalid_request', 'password and confirmPassword are required');
    }
    if (password !== confirmPassword) {
      throw new ApiError(400, 'mismatch', 'Passwords do not match');
    }
    if (password.length < 8) {
      throw new ApiError(400, 'weak_password', 'Password must be at least 8 characters');
    }
    const token = await PasswordResetToken.validateToken(req.params.token);
    if (!token) throw new ApiError(404, 'invalid_token', 'Invalid or expired reset link');
    await token.user.setPassword(password);
    await token.markAsUsed();
    return ok(res, { message: 'Password reset successful' });
  }),
);

module.exports = router;
