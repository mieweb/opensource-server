/**
 * HTTP glue around oidc-provider. The provider answers the protocol endpoints
 * itself (/oauth/authorize, /token, /register, /revoke, discovery); this
 * controller adds what's specific to the manager:
 *
 *   - registration policy before the provider sees /oauth/register;
 *   - hashed client secrets at /oauth/token and /oauth/revoke;
 *   - the interaction (sign-in check + consent page) at /oauth/interaction,
 *     which ties the provider to the manager's own session;
 *   - discovery at the origin root, where MCP clients look for it;
 *   - RFC 9728 protected resource metadata.
 *
 * Non-provider errors use the RFC 6749 wire format (oauthErrorHandler).
 */

const escapeHtml = require('escape-html');
const svc = require('./service');
const { registerClient, parseOAuth } = require('./validator');
const { asyncHandler, generateCsrfToken } = require('../../middlewares/api');
const { requestOrigin } = require('../../utils/request-origin');
const { sendPage } = require('../../utils/html-page');
const { loginRedirectUrl } = require('../../utils/login-redirect');

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}

function errorPage(res, code, message) {
  return sendPage(res, 400, 'Authorization failed', `<h1>Authorization failed</h1>
<p>${escapeHtml(message)}</p>
<p class="note">Error code: <code>${escapeHtml(code)}</code>. Return to the application and try connecting again.</p>`);
}

/** URLSearchParams from interaction params (arrays become repeated keys). */
function toSearchParams(params) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined) out.append(k, item);
  }
  return out;
}

/** CSP `form-action` source allowing the consent POST's redirect chain to reach the client. */
function formActionSource(uri) {
  const u = new URL(uri);
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : u.protocol;
}

/**
 * @param {(origin: string) => import('oidc-provider').Provider} getProvider
 */
function createController(getProvider) {
  const handlers = new WeakMap();
  const providerFor = (req) => getProvider(requestOrigin(req));

  /** Hand the request to the origin's provider. */
  function provider(req, res) {
    const p = providerFor(req);
    let handle = handlers.get(p);
    if (!handle) {
      handle = p.callback();
      handlers.set(p, handle);
    }
    return handle(req, res);
  }

  // --- discovery ---------------------------------------------------------------------------
  function protectedResource(resourcePath) {
    return (req, res) => {
      res.set('Access-Control-Allow-Origin', '*');
      return res.json(svc.protectedResourceMetadata(requestOrigin(req), resourcePath));
    };
  }

  /**
   * The issuer is the bare origin, so clients fetch
   * <origin>/.well-known/oauth-authorization-server. The provider is mounted
   * at /oauth and derives its endpoint URLs from the mount path, which it
   * reads from originalUrl: present the request as if it arrived there.
   */
  function rootDiscovery(req, res) {
    const path = req.path === '/' ? req.baseUrl : `${req.baseUrl}${req.path}`;
    req.url = path;
    req.originalUrl = `/oauth${path}`;
    return provider(req, res);
  }

  // --- registration / token / revocation ---------------------------------------------------
  function checkRegistration(req, res, next) {
    try {
      svc.policy.checkRegistration(parseOAuth(registerClient, req.body, 'invalid_client_metadata'));
    } catch (err) {
      return next(err);
    }
    svc.maybeSweep();
    return next();
  }

  const hashClientSecret = asyncHandler(async (req, res, next) => {
    const { authorization, body } = await svc.normalizeClientAuth({
      authorization: req.headers.authorization,
      body: req.body || {},
    });
    if (authorization) req.headers.authorization = authorization;
    else delete req.headers.authorization;
    req.body = body;
    return next();
  });

  /** client_credentials without `scope` gets the only scope there is (else the token has none). */
  function defaultScope(req, res, next) {
    if (req.body?.grant_type === 'client_credentials' && !req.body.scope) req.body.scope = svc.policy.SCOPE;
    return next();
  }

  // --- interaction (browser) ---------------------------------------------------------------
  async function details(req, res) {
    try {
      return await providerFor(req).interactionDetails(req, res);
    } catch {
      return null;
    }
  }

  function expired(res) {
    return errorPage(res, 'invalid_request', 'This authorization request was already completed or has expired.');
  }

  const interactionGet = asyncHandler(async (req, res) => {
    const d = await details(req, res);
    if (!d) return expired(res);
    // Already answered (a repeated GET, e.g. the SPA navigating twice after
    // sign-in): carry on to where the provider resumes.
    if (d.result) return res.redirect(303, d.returnTo);
    if (!req.session?.user) return res.redirect(302, loginRedirectUrl(req.originalUrl));

    const p = providerFor(req);
    // The provider remembers who signed in last (its own session). When the
    // manager session now belongs to someone else, drop the provider's and
    // start over, rather than let it show its own "log out first" page.
    if (d.session?.accountId && d.session.accountId !== req.session.user) {
      const stale = await p.Session.findByUid(d.session.uid);
      if (stale) await stale.destroy();
      return res.redirect(302, `/oauth/authorize?${toSearchParams(d.params)}`);
    }
    // The provider's sign-in step is answered by the manager session.
    if (d.prompt.name === 'login') {
      return p.interactionFinished(req, res, { login: { accountId: req.session.user } }, { mergeWithLastSubmission: false });
    }

    const client = await svc.describeClient(p, d.params.client_id);
    const identity = client.registrationType === 'metadata_document'
      ? `<p class="note">Identified by <code>${escapeHtml(new URL(client.clientId).host)}</code>.</p>`
      : '<p class="note">The application named itself; this name is not verified.</p>';
    const csrfToken = generateCsrfToken(req);
    return sendPage(res, 200, 'Authorize application', `
<h1>Authorize ${escapeHtml(client.clientName)}</h1>
<p>Signed in as <strong>${escapeHtml(req.session.user)}</strong>.</p>
<p><strong>${escapeHtml(client.clientName)}</strong> is asking to act as you on this manager,
with the same access you have (containers, sites, API).</p>
${identity}
<p>After you approve, you'll be sent back to <code>${escapeHtml(svc.redirectDisplay(d.params.redirect_uri))}</code>.</p>
<p>Only continue if you just tried to connect this application. You can revoke access later.</p>
<form method="post" action="/oauth/interaction/${escapeHtml(d.uid)}">
  <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
  <div class="actions">
    <button class="primary" type="submit" name="decision" value="approve" aria-label="Approve access for ${escapeHtml(client.clientName)}">Approve</button>
    <button type="submit" name="decision" value="deny" aria-label="Deny access">Deny</button>
  </div>
</form>`, formActionSource(d.params.redirect_uri));
  });

  // csrfGuard (app level) has validated `_csrf` for this session request.
  const interactionPost = asyncHandler(async (req, res) => {
    const bearerOnly = (req.get('Authorization') || '').startsWith('Bearer ');
    if (!req.session?.user || bearerOnly) {
      return sendPage(res, 401, 'Not signed in', '<h1>Not signed in</h1><p>Return to the application and try connecting again.</p>');
    }
    const d = await details(req, res);
    if (!d || d.result || d.prompt.name !== 'consent') return expired(res);
    if (d.session?.accountId && d.session.accountId !== req.session.user) {
      return errorPage(res, 'invalid_request', 'You signed in as a different user meanwhile. Return to the application and try again.');
    }

    const p = providerFor(req);
    const result = req.body?.decision === 'approve'
      ? { login: { accountId: req.session.user }, consent: { grantId: await svc.approve(p, d, req.session.user) } }
      : { error: 'access_denied', error_description: 'The user denied the request' };
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    return p.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  });

  // --- errors --------------------------------------------------------------------------------
  function rateLimited(req, res) {
    return res.status(429).json({ error: 'temporarily_unavailable', error_description: 'Too many requests; retry later' });
  }

  /** RFC 6749 §5.2 error responses for the checks that run before the provider. */
  // eslint-disable-next-line no-unused-vars
  function oauthErrorHandler(err, req, res, _next) {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Malformed request body' });
    }
    if (err && Number.isInteger(err.status) && err.status < 500) {
      noStore(res);
      return res.status(err.status).json({ error: err.code || 'invalid_request', error_description: err.message });
    }
    console.error('[oauth] Unhandled error:', err);
    return res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
  }

  return {
    provider,
    protectedResource,
    rootDiscovery,
    checkRegistration,
    hashClientSecret,
    defaultScope,
    interactionGet,
    interactionPost,
    rateLimited,
    oauthErrorHandler,
  };
}

module.exports = { createController };
