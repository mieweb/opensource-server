/**
 * Volume reconcile tests (node --test). Verifies volumesForHost matching by
 * node name and that reconcileVolumes creates directories and reports per-volume
 * results keyed by volume id. chown may fail for a non-root test runner; the
 * test asserts the directory is created and that a result is reported for every
 * volume regardless of chown outcome.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { volumesForHost, reconcileVolumes } = require('../dist/volumes.js');

function makeConfig(nodeName, volumes) {
  return {
    site: {
      id: 1,
      name: 'site',
      internalDomain: null,
      dhcpRange: null,
      subnetMask: null,
      gateway: null,
      dnsForwarders: null,
      nodes: [{ name: nodeName, ipv4Address: null, containers: [], volumes }],
    },
    nginx: { httpServices: [], streamServices: [], externalDomains: [] },
  };
}

test('volumesForHost returns only this host node volumes', () => {
  const cfg = makeConfig('node-a', [
    { id: 1, hostPath: '/tmp/x', mode: 'rw', uid: 100000, gid: 100000 },
  ]);
  assert.equal(volumesForHost(cfg, 'node-a').length, 1);
  assert.equal(volumesForHost(cfg, 'node-b').length, 0);
});

test('reconcileVolumes creates directories and reports per-volume results', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-test-'));
  const dir1 = path.join(base, 'data');
  const dir2 = path.join(base, 'logs');
  const cfg = makeConfig('me', [
    { id: 11, hostPath: dir1, mode: 'rw', uid: process.getuid(), gid: process.getgid() },
    { id: 12, hostPath: dir2, mode: 'ro', uid: process.getuid(), gid: process.getgid() },
  ]);

  const results = reconcileVolumes(cfg, 'me');
  assert.ok(results, 'results should be present');
  assert.deepEqual(Object.keys(results).sort(), ['11', '12']);
  // Using the runner's own uid/gid means chown succeeds, so both apply.
  assert.equal(results['11'].applied, true);
  assert.equal(results['12'].applied, true);
  assert.ok(fs.existsSync(dir1));
  assert.ok(fs.existsSync(dir2));

  fs.rmSync(base, { recursive: true, force: true });
});

test('reconcileVolumes returns undefined when this host has no volumes', () => {
  const cfg = makeConfig('other', [{ id: 1, hostPath: '/tmp/x', mode: 'rw', uid: 0, gid: 0 }]);
  assert.equal(reconcileVolumes(cfg, 'me'), undefined);
});

test('reconcileVolumes reports a failure for an uncreatable path', () => {
  // A path under a file (not a dir) can't be mkdir'd.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-test-'));
  const filePath = path.join(base, 'afile');
  fs.writeFileSync(filePath, 'x');
  const badPath = path.join(filePath, 'sub');
  const cfg = makeConfig('me', [
    { id: 99, hostPath: badPath, mode: 'rw', uid: process.getuid(), gid: process.getgid() },
  ]);
  const results = reconcileVolumes(cfg, 'me');
  assert.equal(results['99'].applied, false);
  assert.ok(results['99'].message);
  fs.rmSync(base, { recursive: true, force: true });
});
