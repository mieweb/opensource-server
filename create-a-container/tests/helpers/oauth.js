/**
 * OAuth flow helpers: register a client, run the authorization code + PKCE
 * flow with a supertest agent against a listening app (see listen.js), and
 * exchange the code for tokens.
 *
 * The provider answers /oauth/authorize with a chain of same-origin
 * redirects (interaction, resume) before the final redirect to the client;
 * follow() walks that chain with the agent's cookies.
 */

const crypto = require('crypto');
const request = require('supertest');
const { REMOTE, csrfFrom } = require('./session');

const REDIRECT_URI = 'http://127.0.0.1:33418/callback';

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** POST /oauth/register; returns the response body. */
async function registerClient(base, overrides = {}) {
  const res = await request(base)
    .post('/oauth/register')
    .set(...REMOTE)
    .send({
      client_name: 'Test MCP Client',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function authorizeUrl(client, { challenge, state = 'st-123', redirectUri = REDIRECT_URI, extra = {} }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'manager',
    state,
    ...extra,
  });
  return `/oauth/authorize?${params.toString()}`;
}

/**
 * Follow same-origin redirects starting from `res`. Stops at a non-redirect
 * (returns the response) or at a redirect off `base` (returns its URL), e.g.
 * the client's redirect_uri or the SPA login.
 */
async function follow(agent, base, res, { stopAt = [] } = {}) {
  for (let i = 0; i < 10 && res.status >= 300 && res.status < 400; i += 1) {
    const loc = new URL(res.headers.location, base);
    if (loc.origin !== base || stopAt.some((p) => loc.pathname.startsWith(p))) return loc;
    res = await agent.get(`${loc.pathname}${loc.search}`).set(...REMOTE);
  }
  return res;
}

/** GET the authorize URL and follow it to the consent page (or the login bounce). */
async function startAuthorization(agent, base, client, opts = {}) {
  const res = await agent.get(authorizeUrl(client, opts)).set(...REMOTE);
  return follow(agent, base, res, { stopAt: ['/login', '/api/v1/auth/oidc/login'] });
}

/** Submit the consent form on `page`; returns the final redirect URL (to the client). */
async function decide(agent, base, page, decision = 'approve') {
  const action = page.text.match(/<form method="post" action="([^"]+)"/)[1];
  const res = await agent
    .post(action)
    .set(...REMOTE)
    .type('form')
    .send({ _csrf: csrfFrom(page.text), decision });
  return follow(agent, base, res);
}

/**
 * Consent + approve with a logged-in agent.
 * @returns {Promise<{ code, location: URL, verifier }>}
 */
async function authorize(agent, base, client, opts = {}) {
  const { verifier, challenge } = opts.pkce || pkcePair();
  const page = await startAuthorization(agent, base, client, { challenge, ...opts });
  if (page instanceof URL || page.status !== 200) {
    throw new Error(`authorize: ${page instanceof URL ? page.href : `${page.status} ${page.text}`}`);
  }
  const location = await decide(agent, base, page);
  if (!(location instanceof URL)) throw new Error(`consent: ${location.status} ${location.text}`);
  return { code: location.searchParams.get('code'), location, verifier };
}

/** Exchange a code; returns the supertest response. */
function exchangeCode(base, client, { code, verifier, redirectUri = REDIRECT_URI, extra = {} }) {
  return request(base)
    .post('/oauth/token')
    .set(...REMOTE)
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      ...extra,
    });
}

function refreshTokens(base, client, refreshToken) {
  return request(base)
    .post('/oauth/token')
    .set(...REMOTE)
    .type('form')
    .send({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: refreshToken });
}

/** authorize + token. Returns the token response body. */
async function obtainTokens(base, agent, client) {
  const { code, verifier } = await authorize(agent, base, client);
  const res = await exchangeCode(base, client, { code, verifier });
  if (res.status !== 200) throw new Error(`token: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

module.exports = {
  REDIRECT_URI,
  pkcePair,
  registerClient,
  authorizeUrl,
  follow,
  startAuthorization,
  decide,
  authorize,
  exchangeCode,
  refreshTokens,
  obtainTokens,
};
