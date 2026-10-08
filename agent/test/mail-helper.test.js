/**
 * mail-helper header-injection tests (node --test): stripping forged
 * List-Unsubscribe headers, adding tokenized RFC 8058 headers, and the
 * per-account / missing-key opt-outs.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { stripUnsubscribeHeaders, addUnsubscribeHeaders, processMessage } = require('../dist/mail-helper.js');

const CRLF = '\r\n';
const MESSAGE = [
  'From: app@example.com',
  'To: someone@example.net',
  'Subject: hi',
  '',
  'body line',
  '..leading dot stays stuffed',
].join(CRLF);

const key = { kid: 'a1b2c3d4', secret: crypto.randomBytes(32).toString('base64'), active: true };
const unsubscribe = { baseUrl: 'https://manager.example.com', keys: [key] };
const db = {
  async getSender(address) {
    if (address === 'app@example.com') return { accountId: 'acc-1', unsubscribeHeaders: true };
    if (address === 'quiet@example.com') return { accountId: 'acc-2', unsubscribeHeaders: false };
    return null;
  },
};

test('stripUnsubscribeHeaders removes forged headers including folded lines', () => {
  const headers = [
    'From: a@b.c',
    'List-Unsubscribe: <https://evil.example/unsub>,',
    ' <mailto:evil@example>',
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    'Subject: x',
  ].join(CRLF);
  assert.equal(stripUnsubscribeHeaders(headers), `From: a@b.c${CRLF}Subject: x`);
});

test('addUnsubscribeHeaders prepends both headers before the body', () => {
  const out = addUnsubscribeHeaders(MESSAGE, { baseUrl: 'https://m.example', token: 'TOK' });
  assert.ok(out.startsWith(`List-Unsubscribe: <https://m.example/u/TOK>${CRLF}List-Unsubscribe-Post: List-Unsubscribe=One-Click${CRLF}From:`));
  // Body (including dot-stuffed lines) is untouched.
  assert.ok(out.endsWith(`body line${CRLF}..leading dot stays stuffed`));
});

test('processMessage injects a valid tokenized header for opted-in accounts', async () => {
  const out = await processMessage(
    { db, unsubscribe },
    { sender: 'app@example.com', recipient: 'Someone@Example.NET' },
    MESSAGE,
  );
  const match = out.match(/^List-Unsubscribe: <https:\/\/manager\.example\.com\/u\/([A-Za-z0-9_-]+)>/);
  assert.ok(match, 'List-Unsubscribe header present');
  assert.match(out, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
});

test('processMessage leaves mail untouched when opted out, unknown, or unconfigured', async () => {
  const cases = [
    [{ db, unsubscribe }, 'quiet@example.com'], // account opted out
    [{ db, unsubscribe }, 'ghost@example.com'], // not a managed sender
    [{ db, unsubscribe: { baseUrl: null, keys: [key] } }, 'app@example.com'], // no base URL
    [{ db, unsubscribe: { baseUrl: 'https://m', keys: [] } }, 'app@example.com'], // no active key
  ];
  for (const [deps, sender] of cases) {
    assert.equal(await processMessage(deps, { sender, recipient: 'r@x.y' }, MESSAGE), MESSAGE);
  }
});
