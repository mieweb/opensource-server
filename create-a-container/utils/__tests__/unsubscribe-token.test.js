/**
 * Unit tests for utils/unsubscribe-token.js — roundtrip, tamper resistance,
 * key selection, and the all-failures-look-identical contract.
 */

const crypto = require('crypto');
const { createUnsubscribeToken, verifyUnsubscribeToken } = require('../unsubscribe-token');

const key = { kid: 'a1b2c3d4', secret: crypto.randomBytes(32).toString('base64') };
const otherKey = { kid: 'ffffffff', secret: crypto.randomBytes(32).toString('base64') };
const payload = { accountId: '7d9fb37e-0000-4000-8000-000000000001', recipient: 'Someone@Example.COM' };

test('roundtrip returns accountId and lowercased recipient', () => {
  const token = createUnsubscribeToken(payload, key);
  expect(token).not.toMatch(/[^A-Za-z0-9_-]/); // base64url — URL-safe
  const verified = verifyUnsubscribeToken(token, [key]);
  expect(verified).toMatchObject({
    accountId: payload.accountId,
    recipient: 'someone@example.com',
  });
  expect(typeof verified.issuedAt).toBe('number');
});

test('any tampering fails verification', () => {
  const token = createUnsubscribeToken(payload, key);
  const buf = Buffer.from(token, 'base64url');
  for (const index of [2, buf.length - 1, 20]) {
    const tampered = Buffer.from(buf);
    tampered[index] ^= 0x01;
    expect(verifyUnsubscribeToken(tampered.toString('base64url'), [key])).toBeNull();
  }
});

test('wrong key and unknown kid both fail', () => {
  const token = createUnsubscribeToken(payload, key);
  expect(verifyUnsubscribeToken(token, [{ kid: key.kid, secret: otherKey.secret }])).toBeNull();
  expect(verifyUnsubscribeToken(token, [otherKey])).toBeNull();
  expect(verifyUnsubscribeToken(token, [])).toBeNull();
});

test('verifies against the matching key in a multi-key set (rotation)', () => {
  const token = createUnsubscribeToken(payload, key);
  expect(verifyUnsubscribeToken(token, [otherKey, key])).not.toBeNull();
});

test('garbage input returns null, never throws', () => {
  for (const junk of ['', 'x', '!!!!', 'AAAA', 'A'.repeat(500), null, undefined]) {
    expect(verifyUnsubscribeToken(junk, [key])).toBeNull();
  }
});
