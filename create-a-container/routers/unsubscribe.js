/**
 * Public one-click unsubscribe endpoint (RFC 8058, issue #67). Mounted at
 * /u OUTSIDE /api/v1 and before the CSRF guard: requests come from mail
 * clients and recipients with no session, token, or credentials. Abuse
 * control (rate limiting) belongs in the proxy, not in-app.
 *
 * GET  /u/:token  confirmation page — a GET NEVER unsubscribes, so link
 *                 scanners that prefetch URLs can't trigger it.
 * POST /u/:token  body `List-Unsubscribe=One-Click` — verify, upsert the
 *                 suppression, 200. Idempotent.
 *
 * Every failure mode (bad token, unknown kid, deleted account) returns the
 * same generic 400 so the endpoint can't be used to probe for accounts or
 * addresses.
 *
 * Pages are server-rendered from views/unsubscribe/*.ejs — recipients and
 * mail providers hit these URLs with no session, so the SPA plays no part.
 */

const path = require('path');
const express = require('express');
const ejs = require('ejs');
const { MailAccount, MailSuppression } = require('../models');
const { asyncHandler } = require('../middlewares/api');
const { verifyUnsubscribeToken, currentUnsubscribeKeys } = require('../utils/unsubscribe-token');

const VIEWS = path.join(__dirname, '..', 'views', 'unsubscribe');

const router = express.Router();

router.use(express.urlencoded({ extended: false }));

/** Render views/unsubscribe/<view>.ejs inside the shared page chrome. */
async function renderPage(res, status, view, data = {}) {
  const body = await ejs.renderFile(path.join(VIEWS, `${view}.ejs`), data);
  const html = await ejs.renderFile(path.join(VIEWS, 'page.ejs'), { title: data.title, body });
  return res.status(status).type('html').send(html);
}

function invalidLink(res) {
  return renderPage(res, 400, 'invalid', { title: 'Invalid link' });
}

/** Verify the token and load its account; null means "answer generic 400". */
async function resolveToken(token) {
  const keys = await currentUnsubscribeKeys();
  const payload = verifyUnsubscribeToken(token, keys);
  if (!payload) return null;
  const account = await MailAccount.findByPk(payload.accountId);
  if (!account) return null;
  return { account, recipient: payload.recipient };
}

router.get('/:token', asyncHandler(async (req, res) => {
  const resolved = await resolveToken(req.params.token);
  if (!resolved) return invalidLink(res);
  return renderPage(res, 200, 'confirm', { title: 'Unsubscribe', recipient: resolved.recipient });
}));

router.post('/:token', asyncHandler(async (req, res) => {
  // RFC 8058 §3.2: the POST body must be List-Unsubscribe=One-Click.
  if ((req.body || {})['List-Unsubscribe'] !== 'One-Click') {
    return invalidLink(res);
  }
  const resolved = await resolveToken(req.params.token);
  if (!resolved) return invalidLink(res);
  await MailSuppression.findOrCreate({
    where: { mailAccountId: resolved.account.id, recipient: resolved.recipient },
    defaults: { source: 'one-click' },
  });
  return renderPage(res, 200, 'done', { title: 'Unsubscribed', recipient: resolved.recipient });
}));

module.exports = router;
