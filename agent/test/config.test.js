/**
 * AGENT_SERVICES parsing (node --test): default groups, explicit lists,
 * dedupe, and rejection of unknown groups.
 */

const test = require('node:test');
const assert = require('node:assert');

const { loadConfig } = require('../dist/config.js');

const BASE_ENV = { SITE_ID: '1', MANAGER_URL: 'http://localhost:3000' };

test('unset AGENT_SERVICES means nginx,dnsmasq', () => {
  assert.deepEqual(loadConfig({ ...BASE_ENV }).services, ['nginx', 'dnsmasq']);
  assert.deepEqual(loadConfig({ ...BASE_ENV, AGENT_SERVICES: '  ' }).services, ['nginx', 'dnsmasq']);
});

test('explicit list is parsed, trimmed, lowercased, and deduped', () => {
  const cfg = loadConfig({ ...BASE_ENV, AGENT_SERVICES: ' Nginx, dnsmasq ,mail, mail ' });
  assert.deepEqual(cfg.services, ['nginx', 'dnsmasq', 'mail']);
});

test('mail-only host is allowed', () => {
  assert.deepEqual(loadConfig({ ...BASE_ENV, AGENT_SERVICES: 'mail' }).services, ['mail']);
});

test('unknown groups are rejected', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, AGENT_SERVICES: 'nginx,launchpad' }),
    /unknown service group "launchpad"/,
  );
});
