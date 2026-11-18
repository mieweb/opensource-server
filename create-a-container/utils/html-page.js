/**
 * Minimal server-rendered HTML pages for browser handoffs that live outside
 * the SPA (CLI login confirmation, OAuth consent). Locked down by default:
 * no scripts, no framing, no caching.
 */

const escapeHtml = require('escape-html');

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} title  Plain text; escaped here.
 * @param {string} body   Trusted HTML; callers escape every interpolated value.
 * @param {string} [formTarget] Extra `form-action` source. Chromium/WebKit apply
 *   `form-action` to the redirects that follow a form submission too, so a page
 *   whose POST is redirected to another origin (loopback port, custom scheme)
 *   must allow it here.
 */
function sendPage(res, status, title, body, formTarget) {
  res
    .status(status)
    .set('Cache-Control', 'no-store')
    .set(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formTarget ? ` ${formTarget}` : ''}`,
    )
    .set('X-Frame-Options', 'DENY')
    .type('html')
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937}
  h1{font-size:1.4rem} code{background:#f3f4f6;padding:.1rem .3rem;border-radius:.2rem}
  .actions{display:flex;gap:.75rem;margin-top:1.5rem}
  .note{color:#6b7280;font-size:.9rem}
  button,a.btn{font:inherit;padding:.5rem 1rem;border-radius:.375rem;border:1px solid #d1d5db;background:#fff;color:inherit;text-decoration:none;cursor:pointer}
  button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
</style></head><body>${body}</body></html>`);
}

module.exports = { sendPage };
