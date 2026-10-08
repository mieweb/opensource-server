/**
 * /api/v1/auth/cli — loopback login handoff for command-line clients (issue #475 §4.3).
 *
 * `mieweb login --target mieweb` (the @mieweb/os-cloud-provider package) starts a
 * temporary HTTP listener on 127.0.0.1:<port> and opens the browser at
 *
 *   GET /api/v1/auth/cli/callback?port=<port>&state=<nonce>[&client=<label>]
 *
 * 1. With no browser session, this route sends the user through the normal
 *    sign-in (OIDC or the SPA password form) and returns here afterwards. It
 *    passes its own URL as a *relative* `redirect`, which the existing
 *    `safeRedirectUrl` allowlist already accepts.
 * 2. With a session, it shows a confirmation page and records a one-time
 *    handoff in the session. A GET never mints a key, so a link or <img>
 *    can't create keys silently.
 * 3. The confirmation form POSTs back here (session + CSRF protected). The route
 *    consumes the one-time handoff (a replayed POST is rejected), mints an API
 *    key for the session user and 303-redirects to
 *    http://127.0.0.1:<port>/callback#key=…&id=…&user=…&state=…
 *
 * Loopback safety: this route does NOT use `safeRedirectUrl`. Only a port is
 * accepted from the client; the redirect host is hard-coded to 127.0.0.1. The
 * CLI-generated `state` nonce is echoed back so the CLI can reject a handoff
 * it didn't start. The key travels in the URL *fragment*, so browsers never
 * send it in a request line, Referer header, or proxy log.
 */

const express = require('express');
const escapeHtml = require('escape-html');
const { isOidcEnabled } = require('../../../utils/oidc');
const { generateCsrfToken, asyncHandler } = require('../../../middlewares/api');
const apiKeys = require('../../../resources/apikeys/service');

const router = express.Router();

// Handoffs claimed by an in-flight POST, keyed by session + state. The claim
// is taken synchronously (no await in between), so two concurrent POSTs of
// the same form can't both read the session's handoff before either save
// lands and both mint a key. (The Manager is a single Node process.)
const claims = new Map();
const CLAIM_TTL_MS = 10 * 60 * 1000;
function claimHandoff(key) {
  const now = Date.now();
  for (const [k, at] of claims) if (now - at > CLAIM_TTL_MS) claims.delete(k);
  if (claims.has(key)) return false;
  claims.set(key, now);
  return true;
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CLIENT_RE = /^[A-Za-z0-9._@-]{1,64}$/;

/**
 * Validate the CLI handoff params. Returns `{ port, state, client }` or throws
 * a string describing the problem (rendered as an HTML error page).
 */
function parseHandoff(src) {
  const port = Number.parseInt(String(src.port ?? ''), 10);
  if (!Number.isInteger(port) || String(port) !== String(src.port) || port < 1024 || port > 65535) {
    throw 'Invalid or missing loopback port.';
  }
  const state = String(src.state ?? '');
  if (!STATE_RE.test(state)) throw 'Invalid or missing state parameter.';
  const rawClient = src.client === undefined || src.client === '' ? null : String(src.client);
  if (rawClient !== null && !CLIENT_RE.test(rawClient)) throw 'Invalid client label.';
  return { port, state, client: rawClient };
}

function page(res, status, title, body) {
  res
    .status(status)
    .set('Cache-Control', 'no-store')
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
    .set('X-Frame-Options', 'DENY')
    .type('html')
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937}
  h1{font-size:1.4rem} code{background:#f3f4f6;padding:.1rem .3rem;border-radius:.2rem}
  .actions{display:flex;gap:.75rem;margin-top:1.5rem}
  button,a.btn{font:inherit;padding:.5rem 1rem;border-radius:.375rem;border:1px solid #d1d5db;background:#fff;color:inherit;text-decoration:none;cursor:pointer}
  button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
</style></head><body>${body}</body></html>`);
}

function errorPage(res, message) {
  return page(res, 400, 'CLI sign-in failed', `<h1>CLI sign-in failed</h1><p>${escapeHtml(message)}</p>
<p>Re-run <code>mieweb login</code> to start over.</p>`);
}

// GET — confirmation page, or bounce through sign-in first.
router.get('/callback', asyncHandler(async (req, res) => {
  let handoff;
  try {
    handoff = parseHandoff(req.query);
  } catch (msg) {
    return errorPage(res, msg);
  }

  if (!req.session?.user) {
    // Only the validated params go into the return URL; anything else in the
    // query string is dropped.
    const params = new URLSearchParams({ port: String(handoff.port), state: handoff.state });
    if (handoff.client) params.set('client', handoff.client);
    const self = `${req.baseUrl}/callback?${params.toString()}`;
    const target = isOidcEnabled()
      ? `/api/v1/auth/oidc/login?redirect=${encodeURIComponent(self)}`
      : `/login?redirect=${encodeURIComponent(self)}`;
    return res.redirect(302, target);
  }

  // One-time handoff, bound to this browser session: the POST below consumes
  // it before minting, so a double-click or retried request can't mint a
  // second key the CLI would never receive (and so could never revoke).
  req.session.cliHandoff = { state: handoff.state, port: handoff.port };
  await saveSession(req);
  const csrfToken = generateCsrfToken(req);
  const label = handoff.client || 'mieweb-cli';
  return page(res, 200, 'Authorize command-line access', `
<h1>Authorize command-line access</h1>
<p>Signed in as <strong>${escapeHtml(req.session.user)}</strong>.</p>
<p>A command-line client (<code>${escapeHtml(label)}</code>) is asking for an API key for your
account. The key will be sent to a program listening on <code>127.0.0.1:${handoff.port}</code>
on <em>this</em> computer.</p>
<p>Only continue if you just ran <code>mieweb login</code>.</p>
<form method="post" action="${escapeHtml(`${req.baseUrl}/callback`)}">
  <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
  <input type="hidden" name="port" value="${handoff.port}">
  <input type="hidden" name="state" value="${escapeHtml(handoff.state)}">
  ${handoff.client ? `<input type="hidden" name="client" value="${escapeHtml(handoff.client)}">` : ''}
  <div class="actions">
    <button class="primary" type="submit">Authorize</button>
    <a class="btn" href="/">Cancel</a>
  </div>
</form>`);
}));

// POST — mint a key for the session user and hand it to the loopback listener.
// csrfGuard (mounted above /auth) has already validated `_csrf` for this
// session-cookie request. Bearer-only callers are rejected: the handoff exists
// to turn a *browser session* into a key, not to let a key mint more keys.
router.post('/callback', asyncHandler(async (req, res) => {
  const bearerOnly = (req.get('Authorization') || '').startsWith('Bearer ');
  if (!req.session?.user || bearerOnly) {
    return page(res, 401, 'Not signed in', '<h1>Not signed in</h1><p>Sign in and re-run <code>mieweb login</code>.</p>');
  }

  let handoff;
  try {
    handoff = parseHandoff(req.body || {});
  } catch (msg) {
    return errorPage(res, msg);
  }

  const pending = req.session.cliHandoff;
  if (
    !pending ||
    pending.state !== handoff.state ||
    pending.port !== handoff.port ||
    !claimHandoff(`${req.sessionID}:${handoff.state}`)
  ) {
    return errorPage(res, 'This sign-in was already completed or has expired.');
  }
  delete req.session.cliHandoff;
  await saveSession(req);

  const description = `${handoff.client || 'mieweb-cli'} (CLI login ${new Date().toISOString().slice(0, 10)})`;
  const { key, plainKey } = await apiKeys.createKey(req.session.user, { description });

  const fragment = new URLSearchParams({
    key: plainKey,
    id: key.id,
    user: req.session.user,
    state: handoff.state,
  });
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  return res.redirect(303, `http://127.0.0.1:${handoff.port}/callback#${fragment.toString()}`);
}));

module.exports = router;
module.exports.parseHandoff = parseHandoff;
