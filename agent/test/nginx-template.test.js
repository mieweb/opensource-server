/**
 * nginx.conf.ejs render tests (node --test, no extra deps). Pins the
 * last-access accounting hooks: module/zone/vars in the http context,
 * per-service mirror + internal location, and their absence from the
 * default/landing/wildcard servers.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'nginx.conf.ejs');

const accounting = { managerUrl: 'https://manager.example.com', apiKey: 'test-key-123' };

function render(data) {
  return ejs.renderFile(TEMPLATE, {
    httpServices: [],
    streamServices: [],
    externalDomains: [],
    accounting,
    ...data,
  });
}

const httpService = {
  id: 42,
  internalPort: 3000,
  container: { ipv4Address: '10.254.1.5' },
  externalHostname: 'myapp',
  backendProtocol: 'http',
  authRequired: false,
  externalDomain: { name: 'example.com', authServer: null },
};

test('http context loads the accounting module, dict, and vars', async () => {
  const conf = await render({});
  assert.match(conf, /js_import accounting from \/opt\/opensource-server\/agent\/njs\/accounting\.js;/);
  assert.match(conf, /js_shared_dict_zone zone=osaas_http:256k timeout=10m evict;/);
  assert.match(conf, /js_var \$osaas_manager_url "https:\/\/manager\.example\.com";/);
  assert.match(conf, /js_var \$osaas_api_key "test-key-123";/);
  // fetch settings are hoisted to http{} level so the mirror location and the
  // relay server both inherit them — one copy each, not per-location.
  assert.strictEqual(conf.match(/js_fetch_trusted_certificate/g).length, 1);
  assert.strictEqual((conf.match(/js_content accounting\.relay;/g) || []).length, 1);
});

test('http service location records last-access via a parallel mirror', async () => {
  const conf = await render({ httpServices: [httpService] });
  assert.match(conf, /set \$osaas_service_id "42";/);
  assert.match(conf, /mirror \/_osaas_accounting;/);
  assert.match(conf, /mirror_request_body off;/);
  assert.match(conf, /location = \/_osaas_accounting/);
  assert.match(conf, /js_content accounting\.http_record;/);
});

test('auth-required service without an auth server gets no accounting hooks', async () => {
  const conf = await render({
    httpServices: [{ ...httpService, authRequired: true }],
  });
  // location / returns 503 — nothing is proxied, nothing is recorded.
  assert.doesNotMatch(conf, /osaas_service_id/);
  assert.doesNotMatch(conf, /mirror \//);
});

test('default, wildcard, and landing servers get no accounting hooks', async () => {
  const conf = await render({ externalDomains: [{ name: 'example.com' }] });
  assert.doesNotMatch(conf, /osaas_service_id/);
  assert.doesNotMatch(conf, /mirror \//);
});

const streamService = {
  id: 77,
  internalPort: 22,
  container: { ipv4Address: '10.254.1.6' },
  externalPort: 30022,
  protocol: 'tcp',
};

test('stream context loads the accounting module, dict, and relay url', async () => {
  const conf = await render({ streamServices: [streamService] });
  assert.match(conf, /js_shared_dict_zone zone=osaas_stream:256k timeout=10m evict;/);
  // js_import appears twice: once in http, once in stream.
  const imports = conf.match(/js_import accounting from \/opt\/opensource-server\/agent\/njs\/accounting\.js;/g);
  assert.strictEqual(imports.length, 2);
  // Streams report via the localhost relay (stream js has no fetch-TLS on
  // Debian njs 0.8.9), so the manager URL and API key must NOT appear in the
  // stream context: the key appears exactly once, as the http-context js_var.
  assert.match(conf, /js_var \$osaas_relay_url "http:\/\/unix:\/run\/nginx-osaas-relay\.sock:";/);
  assert.strictEqual(conf.match(/test-key-123/g).length, 1);
});

test('http context exposes the localhost relay for stream reports', async () => {
  const conf = await render({});
  assert.match(conf, /listen unix:\/run\/nginx-osaas-relay\.sock;/);
  assert.match(conf, /js_content accounting\.relay;/);
});

test('stream server records last-access at the access phase', async () => {
  const conf = await render({ streamServices: [streamService] });
  assert.match(conf, /js_var \$osaas_service_id "77";/);
  assert.match(conf, /js_access accounting\.stream_record;/);
  assert.match(conf, /listen 30022;/);
  assert.match(conf, /proxy_pass 10\.254\.1\.6:22;/);
});
