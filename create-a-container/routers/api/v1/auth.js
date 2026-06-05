/**
 * /api/v1/auth — login, logout, register, password reset, OIDC SSO.
 *
 * Login flow (internal password auth):
 *   1. POST /login { username, password }
 *      → 200 { data: { user, isAdmin, redirect } }   // logged in
 *      → 401 { error }                                // bad credentials
 *      → 403 { error: oidc_enabled }                  // internal login disabled
 *
 * OIDC flow (when an IdP is configured):
 *   1. GET /oidc/login    → 302 redirect to the IdP authorization endpoint
 *   2. GET /oidc/callback → 302 redirect into the SPA with an active session
 */

const express = require('express');
const { Op } = require('sequelize');
const {
  User,
  ExternalDomain,
  PasswordResetToken,
  InviteToken,
} = require('../../../models');
const { sendPasswordResetEmail } = require('../../../utils/email');
const { isSafeRedirectUrl } = require('../../../utils');
const {
  isOidcEnabled,
  isJitProvisioningEnabled,
  buildAuthorizationRequest,
  handleCallback,
  buildEndSessionUrl,
} = require('../../../utils/oidc');
const { asyncHandler, ok, created, ApiError } = require('../../../middlewares/api');

const router = express.Router();

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
  const { Group } = require('../../../models');
  router.post(
    '/dev',
    asyncHandler(async (req, res) => {
      const isAdmin = req.body?.role === 'admin';
      const uid = isAdmin ? 'dev-admin' : 'dev-user';

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
    // When an IdP is configured, internal password login is disabled — users
    // must authenticate through the identity provider.
    if (isOidcEnabled()) {
      throw new ApiError(403, 'oidc_enabled', 'Password login is disabled. Sign in with your identity provider.');
    }

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

    const safeRedirect = await safeRedirectUrl(redirect);
    await activateSession(req, user);
    return ok(res, {
      user: user.uid,
      isAdmin: req.session.isAdmin,
      redirect: safeRedirect,
    });
  }),
);

// GET /api/v1/auth/oidc/login — begin the OIDC authorization-code flow.
router.get(
  '/oidc/login',
  asyncHandler(async (req, res) => {
    if (!isOidcEnabled()) {
      throw new ApiError(404, 'oidc_disabled', 'OIDC is not configured');
    }
    const safeRedirect = await safeRedirectUrl(req.query.redirect);
    const { url, codeVerifier, state, nonce, redirectUri } = await buildAuthorizationRequest(req);
    req.session.oidc = { codeVerifier, state, nonce, redirectUri, redirect: safeRedirect };
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );
    return res.redirect(url);
  }),
);

// GET /api/v1/auth/oidc/callback — complete the flow and start a session.
router.get(
  '/oidc/callback',
  asyncHandler(async (req, res) => {
    if (!isOidcEnabled()) {
      throw new ApiError(404, 'oidc_disabled', 'OIDC is not configured');
    }
    const pending = req.session.oidc;
    const fail = (code) => res.redirect(`/login?oidc_error=${encodeURIComponent(code)}`);

    if (!pending) return fail('expired');
    delete req.session.oidc;

    let claims;
    try {
      claims = await handleCallback(req, pending);
    } catch (err) {
      console.error('OIDC callback error:', err);
      return fail('exchange_failed');
    }

    let result;
    try {
      result = await User.findOrProvisionFromOidc(claims, {
        jitEnabled: isJitProvisioningEnabled(),
      });
    } catch (err) {
      console.error('OIDC provisioning error:', err);
      return fail('provisioning_failed');
    }

    const user = result.user;
    if (!user) return fail(result.code || 'no_account');
    if (user.status !== 'active') return fail('account_inactive');

    await activateSession(req, user);
    // Remember the ID token so logout can perform RP-initiated logout against
    // the IdP (`id_token_hint`). Without this, "Sign out" only clears the local
    // session and the live IdP session immediately signs the user back in.
    req.session.oidcIdToken = claims.idToken || null;
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );
    return res.redirect(pending.redirect || '/');
  }),
);

// POST /api/v1/auth/logout
// Always clears the local session. When OIDC SSO is enabled, also returns a
// `logoutUrl` pointing at the IdP's end-session endpoint so the client can
// redirect there and terminate the IdP session too — otherwise the live IdP
// session would immediately sign the user back in. Falls back to a local-only
// logout when the IdP advertises no end-session endpoint.
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    let logoutUrl = null;
    if (isOidcEnabled()) {
      const idTokenHint = req.session?.oidcIdToken || null;
      // Where the IdP returns the browser after logout. Land on a page that
      // will NOT auto-redirect back into SSO. Defaults to this app's login page
      // with a flag; an explicit OIDC_POST_LOGOUT_REDIRECT_URI takes precedence
      // (and must be registered with the IdP).
      const postLogoutRedirectUri =
        (process.env.OIDC_POST_LOGOUT_REDIRECT_URI || '').trim() ||
        `${req.protocol}://${req.get('host')}/login?logged_out=1`;
      try {
        logoutUrl = await buildEndSessionUrl({ idTokenHint, postLogoutRedirectUri });
      } catch (err) {
        // Discovery/endpoint issues shouldn't block local logout.
        console.error('OIDC end-session URL error:', err);
        logoutUrl = null;
      }
    }

    await new Promise((resolve) =>
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        resolve();
      }),
    );
    return ok(res, { loggedOut: true, logoutUrl });
  }),
);

// GET /api/v1/auth/register/invite/:token — pre-fill data for invitation token
router.get(
  '/register/invite/:token',
  asyncHandler(async (req, res) => {
    if (isOidcEnabled()) {
      throw new ApiError(403, 'oidc_enabled', 'Self-registration is disabled. Sign in with your identity provider.');
    }
    const invite = await InviteToken.validateToken(req.params.token);
    if (!invite) throw new ApiError(404, 'invalid_invite', 'Invalid or expired invitation');
    return ok(res, { email: invite.email });
  }),
);

// POST /api/v1/auth/register
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    if (isOidcEnabled()) {
      throw new ApiError(403, 'oidc_enabled', 'Self-registration is disabled. Sign in with your identity provider.');
    }
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

    return created(res, {
      uid,
      status,
      message: isInvitedUser
        ? 'Account created. You can now log in.'
        : 'Account registered. You will be notified once approved.',
    });
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
