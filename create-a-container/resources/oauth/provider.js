/**
 * oidc-provider configuration: the manager's OAuth 2.1 authorization server.
 *
 * One Provider per public origin (issuer), created on first use and cached.
 * The issuer has to be fixed when a Provider is constructed, but the manager
 * derives its public origin from each request (trust proxy), so this keeps
 * the issuer request-derived with no extra setting. All Providers share the
 * same database (adapter.js), so clients and grants are visible from every
 * origin, while each token is audienced to the origin it was issued for.
 */

const crypto = require('crypto');
const escapeHtml = require('escape-html');
const { LRUCache } = require('lru-cache');
const { Provider, errors } = require('oidc-provider');
const { SequelizeAdapter } = require('./adapter');
const { sendPage } = require('../../utils/html-page');
const { User } = require('../../models');
const {
  SCOPE,
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  CODE_TTL_SEC,
  isManagerResource,
} = require('./service/policy');

const DAY = 24 * 60 * 60;

// Signing keys: tokens are opaque and no ID tokens are issued, so these sign
// nothing persistent. Generated per process to avoid the library's shared
// development keys.
let jwks;
function getJwks() {
  if (!jwks) {
    // RS256: the provider's default for client metadata such as
    // id_token_signed_response_alg.
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    jwks = { keys: [{ ...privateKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid: crypto.randomUUID() }] };
  }
  return jwks;
}

async function renderError(ctx, out) {
  const res = ctx.res;
  ctx.respond = false; // we write the response ourselves
  sendPage(res, ctx.status || 400, 'Authorization failed', `<h1>Authorization failed</h1>
<p>${escapeHtml(out.error_description || 'The request could not be completed.')}</p>
<p class="note">Error code: <code>${escapeHtml(out.error || 'invalid_request')}</code>. Return to the application and try connecting again.</p>`);
}

/** Provider configuration for one origin. */
function baseConfiguration(origin, { cookieKeys }) {
  return {
    adapter: (model) => new SequelizeAdapter(model),
    jwks: getJwks(),
    cookies: { keys: cookieKeys },
    scopes: [SCOPE],
    claims: { openid: ['sub'] },
    responseTypes: ['code'],
    pkce: { required: () => true },
    clientDefaults: {
      // MCP clients are mostly native apps (loopback or custom-scheme
      // redirects) and rarely send application_type; the OIDC default
      // ('web') would reject vscode:// and similar. resources/oauth's
      // registration check still enforces our redirect URI policy.
      application_type: 'native',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: SCOPE,
      token_endpoint_auth_method: 'client_secret_basic',
    },
    routes: {
      authorization: '/authorize',
      token: '/token',
      registration: '/register',
      revocation: '/revoke',
      jwks: '/jwks',
      end_session: '/session/end',
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      registration: {
        enabled: true,
        idFactory: () => `mcp_${crypto.randomBytes(18).toString('base64url')}`,
        secretFactory: () => crypto.randomBytes(32).toString('base64url'),
      },
      revocation: { enabled: true },
      // Machine-to-machine access (issue #518). Only owned clients created on
      // the API keys page can use it: dynamic registration refuses the grant
      // (service/policy.js) and metadata-document clients have no secret.
      clientCredentials: { enabled: true },
      clientIdMetadataDocument: { enabled: true, ack: 'draft-03' },
      resourceIndicators: {
        enabled: true,
        // No `resource` sent: the manager origin, or what was granted.
        defaultResource: (ctx, client, oneOf) => (oneOf ? [].concat(oneOf)[0] : origin),
        useGrantedResource: () => true,
        getResourceServerInfo(ctx, resource) {
          if (!isManagerResource(resource, origin)) {
            throw new errors.InvalidTarget(`This authorization server only issues tokens for ${origin}`);
          }
          return { scope: SCOPE, audience: origin, accessTokenFormat: 'opaque', accessTokenTTL: ACCESS_TOKEN_TTL_SEC };
        },
      },
    },
    ttl: {
      AccessToken: ACCESS_TOKEN_TTL_SEC,
      AuthorizationCode: CODE_TTL_SEC,
      ClientCredentials: ACCESS_TOKEN_TTL_SEC,
      Grant: 365 * DAY,
      Interaction: 10 * 60,
      RefreshToken: REFRESH_TOKEN_TTL_SEC,
      Session: DAY,
    },
    rotateRefreshToken: true,
    issueRefreshToken: async (ctx, client) => client.grantTypeAllowed('refresh_token'),
    // Tokens outlive the provider's internal session (it isn't the user's
    // manager session); they end by expiry or by revoking the grant.
    expiresWithSession: async () => false,
    // Consent is shown on every authorization; the grant the consent page
    // just created is the only one loaded.
    async loadExistingGrant(ctx) {
      const grantId = ctx.oidc.result?.consent?.grantId;
      return grantId ? ctx.oidc.provider.Grant.find(grantId) : undefined;
    },
    async findAccount(ctx, sub) {
      const user = await User.findOne({ where: { uid: sub }, attributes: ['uid', 'status'] });
      if (!user || user.status !== 'active') return undefined;
      return { accountId: user.uid, claims: () => ({ sub: user.uid }) };
    },
    interactions: { url: (ctx, interaction) => `/oauth/interaction/${interaction.uid}` },
    // Browser-based MCP clients call the token endpoint cross-origin; none of
    // these endpoints use cookies.
    clientBasedCORS: () => true,
    renderError,
  };
}

/**
 * @param {object} opts
 * @param {string[]} opts.cookieKeys keys signing the provider's own cookies
 * @returns {(origin: string) => Provider}
 */
function createProviderRegistry({ cookieKeys }) {
  // Bounded: Host headers are client-controlled, so a flood of made-up hosts
  // must not grow this without limit. Evicting only costs a rebuild.
  const providers = new LRUCache({ max: 16 });
  return function getProvider(origin) {
    let provider = providers.get(origin);
    if (!provider) {
      provider = new Provider(origin, baseConfiguration(origin, { cookieKeys }));
      provider.proxy = true;
      providers.set(origin, provider);
    }
    return provider;
  };
}

module.exports = { createProviderRegistry };
