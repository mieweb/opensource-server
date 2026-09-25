/**
 * Volume reconcile tests (node --test). Verifies volumesForSite reads the
 * site-level volumes and that reconcileVolumes creates directories and reports
 * per-volume results keyed by volume id. The agent chmods but does not chown
 * (id-map establishes ownership), so these tests run fine as a non-root runner.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { volumesForSite, reconcileVolumes } = require('../dist/volumes.js');

function makeConfig(volumes) {
  return {
    site: {
      id: 1,
      name: 'site',
      internalDomain: null,
      dhcpRange: null,
      subnetMask: null,
      gateway: null,
      dnsForwarders: null,
      nodes: [],
      volumes,
    },
    nginx: { httpServices: [], streamServices: [], externalDomains: [] },
  };
}

test('volumesForSite returns the site-level volumes', () => {
  const cfg = makeConfig([{ id: 1, hostPath: '/tmp/x', mode: 'rw' }]);
  assert.equal(volumesForSite(cfg).length, 1);
  assert.equal(volumesForSite({ site: null, nginx: {} }).length, 0);
});

test('reconcileVolumes creates directories and reports per-volume results', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-test-'));
  const dir1 = path.join(base, 'data');
  const dir2 = path.join(base, 'logs');
  const cfg = makeConfig([
    { id: 11, hostPath: dir1, mode: 'rw' },
    { id: 12, hostPath: dir2, mode: 'ro' },
  ]);

  const results = reconcileVolumes(cfg);
  assert.ok(results, 'results should be present');
  assert.deepEqual(Object.keys(results).sort(), ['11', '12']);
  assert.equal(results['11'].applied, true);
  assert.equal(results['12'].applied, true);
  assert.ok(fs.existsSync(dir1));
  assert.ok(fs.existsSync(dir2));

  fs.rmSync(base, { recursive: true, force: true });
});

test('reconcileVolumes returns undefined when the site has no volumes', () => {
  assert.equal(reconcileVolumes(makeConfig([])), undefined);
});

test('reconcileVolumes reports a failure for an uncreatable path', () => {
  // A path under a file (not a dir) can't be mkdir'd.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-test-'));
  const filePath = path.join(base, 'afile');
  fs.writeFileSync(filePath, 'x');
  const badPath = path.join(filePath, 'sub');
  const cfg = makeConfig([{ id: 99, hostPath: badPath, mode: 'rw' }]);
  const results = reconcileVolumes(cfg);
  assert.equal(results['99'].applied, false);
  assert.ok(results['99'].message);
  fs.rmSync(base, { recursive: true, force: true });
});
