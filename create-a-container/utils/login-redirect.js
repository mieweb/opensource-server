/**
 * Where to send a browser that needs a manager session before it can finish
 * a handoff (CLI login, OAuth authorize). With OIDC enabled the IdP login is
 * started directly; otherwise the SPA's password form. Either way the user
 * returns to `returnTo` afterwards.
 *
 * `returnTo` must be a relative path: the login routes' `safeRedirectUrl`
 * allowlist accepts those and rejects anything else.
 */

const { isOidcEnabled } = require('./oidc');

function loginRedirectUrl(returnTo) {
  const encoded = encodeURIComponent(returnTo);
  return isOidcEnabled()
    ? `/api/v1/auth/oidc/login?redirect=${encoded}`
    : `/login?redirect=${encoded}`;
}

module.exports = { loginRedirectUrl };
