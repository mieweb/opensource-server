'use strict';

/**
 * OIDC (OpenID Connect) integration.
 *
 * Configuration is read from environment variables. OIDC is considered
 * "enabled" only when the issuer, client id, and client secret are all set.
 * When enabled, the login screen redirects to the IdP and internal
 * password login / self-registration are disabled.
 *
 * Env vars:
 *   OIDC_ISSUER_URL              Discovery base URL of the IdP (required)
 *   OIDC_CLIENT_ID               OAuth2 client id (required)
 *   OIDC_CLIENT_SECRET           OAuth2 client secret (required)
 *   OIDC_REDIRECT_URI            Absolute callback URL registered with the IdP.
 *                                If unset, it is derived from the request host
 *                                as `${protocol}://${host}/api/v1/auth/oidc/callback`.
 *   OIDC_SCOPES                  Space-separated scopes (default "openid profile email")
 *   OIDC_JIT_PROVISION           "true" to auto-create users on first login
 *   OIDC_POST_LOGOUT_REDIRECT_URI  Optional RP-initiated logout return URL
 */

const { Issuer, generators } = require('openid-client');

const CALLBACK_PATH = '/api/v1/auth/oidc/callback';

function isOidcEnabled() {
  return Boolean(
    process.env.OIDC_ISSUER_URL &&
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_CLIENT_SECRET,
  );
}

function isJitProvisioningEnabled() {
  return (process.env.OIDC_JIT_PROVISION || '').toLowerCase() === 'true';
}

function getScopes() {
  return (process.env.OIDC_SCOPES || 'openid profile email').trim();
}

// Derive the redirect URI: prefer the explicit env var, otherwise build it
// from the incoming request so a single deployment works without extra config.
function getRedirectUri(req) {
  const configured = (process.env.OIDC_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const proto = req.protocol;
  const host = req.get('host');
  return `${proto}://${host}${CALLBACK_PATH}`;
}

// Lazily discover the issuer and build a Client. Cached after first success.
let cachedClient = null;
async function getClient(redirectUri) {
  if (!isOidcEnabled()) {
    throw new Error('OIDC is not configured');
  }
  if (!cachedClient) {
    const issuer = await Issuer.discover(process.env.OIDC_ISSUER_URL);
    cachedClient = new issuer.Client({
      client_id: process.env.OIDC_CLIENT_ID,
      client_secret: process.env.OIDC_CLIENT_SECRET,
      redirect_uris: redirectUri ? [redirectUri] : undefined,
      response_types: ['code'],
    });
  }
  return cachedClient;
}

/**
 * Build the authorization URL and the transient values that must be stored in
 * the session and replayed during the callback (PKCE verifier, state, nonce).
 */
async function buildAuthorizationRequest(req) {
  const redirectUri = getRedirectUri(req);
  const client = await getClient(redirectUri);

  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();

  const url = client.authorizationUrl({
    scope: getScopes(),
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return { url, codeVerifier, state, nonce, redirectUri };
}

/**
 * Complete the authorization-code exchange and validate the ID token.
 * Returns the normalized identity claims.
 */
async function handleCallback(req, { codeVerifier, state, nonce, redirectUri }) {
  const client = await getClient(redirectUri);
  const params = client.callbackParams(req);
  const tokenSet = await client.callback(redirectUri, params, {
    code_verifier: codeVerifier,
    state,
    nonce,
  });

  const claims = tokenSet.claims();
  return {
    // Raw ID token, replayed as `id_token_hint` during RP-initiated logout so
    // the IdP can identify (and end) the right session without re-prompting.
    idToken: tokenSet.id_token || null,
    sub: claims.sub,
    issuer: claims.iss,
    email: claims.email ? String(claims.email).toLowerCase().trim() : null,
    emailVerified: claims.email_verified,
    preferredUsername: claims.preferred_username || null,
    givenName: claims.given_name || null,
    familyName: claims.family_name || null,
    name: claims.name || null,
  };
}

function getPostLogoutRedirectUri() {
  return (process.env.OIDC_POST_LOGOUT_REDIRECT_URI || '').trim() || null;
}

/**
 * Build the IdP's RP-initiated logout URL (the `end_session_endpoint`) so the
 * browser can be redirected there to terminate the IdP session — not just the
 * local app session. Returns null when the IdP's discovery document does not
 * advertise an end-session endpoint, in which case callers should fall back to
 * a local-only logout.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.idTokenHint] Raw ID token from the login that is
 *   being ended. Recommended by the spec; lets the IdP skip a logout prompt.
 * @param {string|null} [opts.postLogoutRedirectUri] Where the IdP should send
 *   the browser after logout. Must be registered with the IdP. Defaults to
 *   OIDC_POST_LOGOUT_REDIRECT_URI.
 */
async function buildEndSessionUrl({ idTokenHint, postLogoutRedirectUri } = {}) {
  const client = await getClient();
  // openid-client throws if the issuer has no end_session_endpoint.
  if (!client.issuer.metadata.end_session_endpoint) return null;

  const redirect = postLogoutRedirectUri || getPostLogoutRedirectUri();
  return client.endSessionUrl({
    ...(idTokenHint ? { id_token_hint: idTokenHint } : {}),
    ...(redirect ? { post_logout_redirect_uri: redirect } : {}),
  });
}

module.exports = {
  CALLBACK_PATH,
  isOidcEnabled,
  isJitProvisioningEnabled,
  getScopes,
  getRedirectUri,
  getClient,
  buildAuthorizationRequest,
  handleCallback,
  getPostLogoutRedirectUri,
  buildEndSessionUrl,
};
