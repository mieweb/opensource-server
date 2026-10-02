/**
 * Volume reconcile tests (node --test). Verifies volumesForSite reads the
 * site-level volumes, that reconcileVolumes creates directories and reports
 * per-volume results keyed by volume id, and that a chown to an unmapped host
 * id (the normal unprivileged-agent case) is tolerated rather than failing the
 * volume.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  volumesForSite,
  reconcileVolumes,
  containingMountPoint,
  readMountPoints,
} = require('../dist/volumes.js');

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

  const results = reconcileVolumes(cfg, [base]);
  assert.ok(results, 'results should be present');
  assert.deepEqual(Object.keys(results).sort(), ['11', '12']);
  assert.equal(results['11'].applied, true);
  assert.equal(results['12'].applied, true);
  assert.ok(fs.existsSync(dir1));
  assert.ok(fs.existsSync(dir2));

  fs.rmSync(base, { recursive: true, force: true });
});

test('reconcileVolumes returns undefined when the site has no volumes', () => {
  assert.equal(reconcileVolumes(makeConfig([]), []), undefined);
});

test('tolerates a chown to an unmapped/denied host id (unprivileged agent case)', () => {
  // Ask for owner 100000: as a non-root runner (or inside an unprivileged
  // namespace) chown will fail with EPERM/EINVAL. The volume must still be
  // reported applied — ownership is established by the id-map, not the chown.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-test-'));
  const dir = path.join(base, 'data');
  const cfg = makeConfig([{ id: 7, hostPath: dir, mode: 'rw', uid: 100000, gid: 100000 }]);
  const results = reconcileVolumes(cfg, [base]);
  assert.equal(results['7'].applied, true);
  assert.ok(fs.existsSync(dir));
  fs.rmSync(base, { recursive: true, force: true });
});

test('reconcileVolumes reports a failure for an uncreatable path', () => {
  // A path under a file (not a dir) can't be mkdir'd.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-test-'));
  const filePath = path.join(base, 'afile');
  fs.writeFileSync(filePath, 'x');
  const badPath = path.join(filePath, 'sub');
  const cfg = makeConfig([{ id: 99, hostPath: badPath, mode: 'rw' }]);
  const results = reconcileVolumes(cfg, [base]);
  assert.equal(results['99'].applied, false);
  assert.ok(results['99'].message);
  fs.rmSync(base, { recursive: true, force: true });
});

test('refuses a path that is not on a mounted volumes root (and creates nothing)', () => {
  // The volumes root was never bind-mounted into the agent: the only mount
  // containing the path is '/', so mkdir -p would create it inside the agent's
  // own filesystem. It must be reported as a failure instead.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-test-'));
  const dir = path.join(base, 'data');
  const results = reconcileVolumes(makeConfig([{ id: 5, hostPath: dir, mode: 'rw' }]), ['/']);
  assert.equal(results['5'].applied, false);
  assert.match(results['5'].message, /not on a mounted volumes root/);
  assert.equal(fs.existsSync(dir), false);
  fs.rmSync(base, { recursive: true, force: true });
});

test('containingMountPoint picks the deepest enclosing mount, not a prefix sibling', () => {
  const mounts = ['/', '/proc', '/mnt/pve/cephfs', '/mnt/pve/cephfs/volumes'];
  assert.equal(containingMountPoint('/mnt/pve/cephfs/volumes/site-1/u/h/data', mounts), '/mnt/pve/cephfs/volumes');
  assert.equal(containingMountPoint('/mnt/pve/cephfs/other', mounts), '/mnt/pve/cephfs');
  // '/mnt/pve/cephfs-2' only shares a string prefix with '/mnt/pve/cephfs'.
  assert.equal(containingMountPoint('/mnt/pve/cephfs-2/x', mounts), '/');
  assert.equal(containingMountPoint('/var/lib/vz/volumes/x', mounts), '/');
});

test('readMountPoints parses this process\'s mount table', () => {
  const mounts = readMountPoints();
  assert.ok(mounts.includes('/'));
  assert.ok(mounts.includes('/proc'));
});
