/**
 * Postfix check-in state decision (node --test).
 *
 * Debian <= 12: postfix.service is a RemainAfterExit wrapper (active/exited)
 * and the real daemon lives on postfix@-. Debian 13: master runs directly in
 * postfix.service and postfix@- stays inactive. pickPostfixState must report
 * the truth on both layouts.
 */

const test = require('node:test');
const assert = require('node:assert');
const { pickPostfixState } = require('../dist/mail.js');

test('Debian <= 12: instance unit state wins', () => {
  assert.strictEqual(pickPostfixState('active', 'active', 'exited'), 'active');
  assert.strictEqual(pickPostfixState('failed', 'active', 'exited'), 'failed');
  assert.strictEqual(pickPostfixState('activating', 'active', 'exited'), 'activating');
});

test('Debian <= 12: wrapper active (exited) does not mask a dead instance', () => {
  assert.strictEqual(pickPostfixState('inactive', 'active', 'exited'), 'inactive');
});

test('Debian 13: running master in postfix.service reports active', () => {
  assert.strictEqual(pickPostfixState('inactive', 'active', 'running'), 'active');
  assert.strictEqual(pickPostfixState('unknown', 'active', 'running'), 'active');
});

test('nothing running anywhere reports the instance state', () => {
  assert.strictEqual(pickPostfixState('inactive', 'inactive', 'dead'), 'inactive');
  assert.strictEqual(pickPostfixState('unknown', 'unknown', 'unknown'), 'unknown');
});
