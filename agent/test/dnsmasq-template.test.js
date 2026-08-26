/**
 * dnsmasq conf.ejs render test (node --test, no extra deps).
 *
 * Pins that dnsmasq resolves `localhost` to loopback. The config uses
 * `no-hosts`, so dnsmasq ignores /etc/hosts and would otherwise fail to
 * resolve `localhost` — which breaks nginx's resolver-based lookups, e.g.
 * the njs accounting module's ngx.fetch to the manager's own
 * http://localhost:3000 (observed as: `"localhost" could not be resolved`).
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'dnsmasq', 'conf.ejs');

const site = {
  internalDomain: 'site.example',
  dhcpRange: '10.254.1.100,10.254.1.200',
  subnetMask: '255.255.255.0',
  gateway: '10.254.1.1',
  dnsForwarders: '1.1.1.1',
  nodes: [],
};

function render() {
  return ejs.renderFile(TEMPLATE, { site });
}

test('dnsmasq resolves localhost to loopback (v4 and v6)', async () => {
  const conf = await render();
  assert.match(conf, /^address=\/localhost\/127\.0\.0\.1$/m);
  assert.match(conf, /^address=\/localhost\/::1$/m);
});

test('the localhost override coexists with no-hosts', async () => {
  const conf = await render();
  // no-hosts is why the explicit address= is needed; both must be present.
  assert.match(conf, /^no-hosts$/m);
});
