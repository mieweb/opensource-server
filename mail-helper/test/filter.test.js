/**
 * Filter decision tests (node --test). Run `make deps` first — it copies the
 * canonical unsubscribe-token module from create-a-container.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { parseAddress, rcptDecision, unsubscribeHeaders, isUnsubscribeHeader } = require('../src/filter');

const key = { kid: 'a1b2c3d4', secret: crypto.randomBytes(32).toString('base64'), active: true };
const unsubscribe = { baseUrl: 'https://manager.example.com', keys: [key] };

const db = {
  async getSender(address) {
    if (address === 'app@example.com') return { accountId: 'acc-1', unsubscribeHeaders: true };
    if (address === 'quiet@example.com') return { accountId: 'acc-2', unsubscribeHeaders: false };
    return null;
  },
  async isSuppressed(sender, recipient) {
    return sender === 'app@example.com' && recipient === 'optedout@example.net';
  },
};

test('parseAddress normalizes envelope forms', () => {
  assert.equal(parseAddress('<App@Example.COM>'), 'app@example.com');
  assert.equal(parseAddress('app@example.com SIZE=1024'), 'app@example.com');
  assert.equal(parseAddress('<>'), '');
});

test('rcptDecision rejects suppressed recipients with 5.7.1', async () => {
  const hit = await rcptDecision(db, 'app@example.com', 'optedout@example.net');
  assert.equal(hit.action, 'reject');
  assert.match(hit.message, /^5\.7\.1 /);

  const miss = await rcptDecision(db, 'app@example.com', 'someone@example.net');
  assert.equal(miss.action, 'continue');
});

test('rcptDecision DEFERS on DB failure (fail closed)', async () => {
  const broken = { async isSuppressed() { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); } };
  const decision = await rcptDecision(broken, 'app@example.com', 'x@y.z');
  assert.equal(decision.action, 'tempfail');
  assert.match(decision.message, /^4\.3\.0 /);
});

test('unsubscribeHeaders adds tokenized headers for one opted-in recipient', async () => {
  const headers = await unsubscribeHeaders({ db, unsubscribe }, 'app@example.com', ['someone@example.net']);
  assert.equal(headers.length, 2);
  assert.match(headers[0].value, /^<https:\/\/manager\.example\.com\/u\/[A-Za-z0-9_-]+>$/);
  assert.equal(headers[1].value, 'List-Unsubscribe=One-Click');
});

test('unsubscribeHeaders is skipped when not applicable', async () => {
  const cases = [
    [{ db, unsubscribe }, 'quiet@example.com', ['r@x.y']], // account opted out
    [{ db, unsubscribe }, 'ghost@example.com', ['r@x.y']], // not a managed sender
    [{ db, unsubscribe }, 'app@example.com', ['a@x.y', 'b@x.y']], // tokens are per-recipient
    [{ db, unsubscribe: { baseUrl: null, keys: [key] } }, 'app@example.com', ['r@x.y']],
    [{ db, unsubscribe: { baseUrl: 'https://m', keys: [] } }, 'app@example.com', ['r@x.y']],
  ];
  for (const [deps, sender, recipients] of cases) {
    assert.deepEqual(await unsubscribeHeaders(deps, sender, recipients), []);
  }
});

test('isUnsubscribeHeader matches both owned header names, case-insensitive', () => {
  assert.ok(isUnsubscribeHeader('List-Unsubscribe'));
  assert.ok(isUnsubscribeHeader('list-unsubscribe-post'));
  assert.ok(!isUnsubscribeHeader('List-Id'));
});
