/**
 * Public one-click unsubscribe endpoint (RFC 8058, issue #67). Mounted at
 * /u OUTSIDE /api/v1 and before the CSRF guard: requests come from mail
 * clients and recipients with no session, token, or credentials.
 *
 * GET  /u/:token  confirmation page — a GET NEVER unsubscribes, so link
 *                 scanners that prefetch URLs can't trigger it.
 * POST /u/:token  body `List-Unsubscribe=One-Click` — verify, upsert the
 *                 suppression, 200. Idempotent.
 *
 * Every failure mode (bad token, unknown kid, deleted account) returns the
 * same generic 400 so the endpoint can't be used to probe for accounts or
 * addresses.
 */

const express = require('express');
const { MailAccount, MailSuppression, MailUnsubscribeKey } = require('../models');
const { asyncHandler } = require('../middlewares/api');
const { rateLimit } = require('../middlewares/rate-limit');
const { verifyUnsubscribeToken } = require('../utils/unsubscribe-token');

const router = express.Router();

router.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 60 }));
router.use(express.urlencoded({ extended: false }));

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
  button { font-size: 1rem; padding: .6rem 1.2rem; cursor: pointer; }
</style>
</head>
<body>
<main>${body}</main>
</body>
</html>`;
}

const GENERIC_400 = page(
  'Invalid link',
  '<h1>Invalid link</h1><p>This unsubscribe link is invalid or has expired.</p>',
);

/** Verify the token and load its account; null means "answer generic 400". */
async function resolveToken(token) {
  const keys = await MailUnsubscribeKey.verifiable();
  const payload = verifyUnsubscribeToken(token, keys);
  if (!payload) return null;
  const account = await MailAccount.findByPk(payload.accountId);
  if (!account) return null;
  return { account, recipient: payload.recipient };
}

router.get('/:token', asyncHandler(async (req, res) => {
  const resolved = await resolveToken(req.params.token);
  if (!resolved) return res.status(400).type('html').send(GENERIC_400);
  const recipient = escapeHtml(resolved.recipient);
  return res.type('html').send(page('Unsubscribe', `
<h1>Unsubscribe</h1>
<p>Stop receiving email to <strong>${recipient}</strong> from this sender?</p>
<form method="post" action="">
  <input type="hidden" name="List-Unsubscribe" value="One-Click">
  <button type="submit" aria-label="Confirm unsubscribe for ${recipient}">Unsubscribe</button>
</form>`));
}));

router.post('/:token', asyncHandler(async (req, res) => {
  // RFC 8058 §3.2: the POST body must be List-Unsubscribe=One-Click.
  if ((req.body || {})['List-Unsubscribe'] !== 'One-Click') {
    return res.status(400).type('html').send(GENERIC_400);
  }
  const resolved = await resolveToken(req.params.token);
  if (!resolved) return res.status(400).type('html').send(GENERIC_400);
  await MailSuppression.findOrCreate({
    where: { mailAccountId: resolved.account.id, recipient: resolved.recipient },
    defaults: { source: 'one-click' },
  });
  return res.type('html').send(page('Unsubscribed', `
<h1>Unsubscribed</h1>
<p><strong>${escapeHtml(resolved.recipient)}</strong> will no longer receive email from this sender.</p>`));
}));

module.exports = router;
