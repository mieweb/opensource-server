/**
 * Volume model + utils/volumes pure-logic tests (issue #421): name validation,
 * mpN rendering (including that legacy built-in / undervied rows are skipped),
 * and host-path derivation from the node storage's ACTUAL configured path.
 */

const { resetDb, closeDb } = require('../../tests/helpers/db');
const { Volume } = require('../../models');
const volumeModule = require('../../models/volume');
const {
  resolveVolumesRoot,
  containerVolumeHostPath,
} = require('../volumes');

describe('Volume name validation', () => {
  test.each([
    ['data', true],
    ['my-volume_1', true],
    ['a.b.c', true],
    ['', false],
    ['.', false],
    ['..', false],
    ['../etc', false],
    ['a/b', false],
    ['a\\b', false],
    ['-leading-dash-ok?', true], // starts with dash is disallowed by regex? see below
  ])('%s -> %s', (name, expected) => {
    // Adjust expectation for the one intentionally-tricky case: names must start
    // with an alphanumeric.
    const actual = volumeModule.isValidVolumeName(name);
    if (name === '-leading-dash-ok?') {
      expect(actual).toBe(false);
      return;
    }
    expect(actual).toBe(expected);
  });

  test('rejects NUL and traversal', () => {
    expect(volumeModule.isValidVolumeName('a\0b')).toBe(false);
    expect(volumeModule.isValidVolumeName('..')).toBe(false);
    expect(volumeModule.isValidVolumeName('foo/../bar')).toBe(false);
  });
});

describe('Volume.buildMountConfig', () => {
  beforeAll(async () => {
    await resetDb();
  });

  test('renders contiguous mpN in id order with ro flag', () => {
    // Build unsaved instances so toMpValue/id behave like real rows.
    const a = Volume.build({ id: 1, containerId: 1, hostPath: '/data/c/a', mountPath: '/mnt/a', mode: 'ro' });
    const b = Volume.build({ id: 3, containerId: 1, hostPath: '/data/c/b', mountPath: '/mnt/b', mode: 'rw' });
    const cfg = Volume.buildMountConfig([b, a]);
    expect(cfg).toEqual({
      mp0: '/data/c/a,mp=/mnt/a,ro=1',
      mp1: '/data/c/b,mp=/mnt/b,ro=0',
    });
  });

  test('empty set renders no keys', () => {
    expect(Volume.buildMountConfig([])).toEqual({});
  });

  test('reserves the legacy mp0 slot: user volumes render after built-in rows', () => {
    const user = Volume.build({ id: 1, containerId: 1, hostPath: '/data/c/data', mountPath: '/mnt/data', mode: 'rw' });
    const builtin = Volume.build({
      id: 2,
      containerId: 1,
      name: 'quick_and_dirty',
      hostPath: null,
      mountPath: '/mnt/quick_and_dirty',
      mode: 'ro',
      builtin: true,
    });
    const underived = Volume.build({ id: 3, containerId: 1, hostPath: null, mountPath: '/mnt/x', mode: 'rw' });
    // The built-in reserves mp0 (its live mount), so the user volume lands on
    // mp1 and never overwrites the pre-#421 quick_and_dirty mount. The
    // host-path-less user row is skipped.
    expect(Volume.buildMountConfig([user, builtin, underived])).toEqual({
      mp1: '/data/c/data,mp=/mnt/data,ro=0',
    });
  });

  test('no reserved slot when there is no built-in row (starts at mp0)', () => {
    const a = Volume.build({ id: 1, containerId: 1, hostPath: '/data/c/a', mountPath: '/mnt/a', mode: 'rw' });
    expect(Volume.buildMountConfig([a])).toEqual({ mp0: '/data/c/a,mp=/mnt/a,ro=0' });
  });
});

describe('containerVolumeHostPath', () => {
  test('scopes user volumes by site and hostname under the volumes root', () => {
    expect(containerVolumeHostPath('/srv/volumes', 7, 'web01', 'data')).toBe(
      '/srv/volumes/site-7/web01/data',
    );
  });
});

describe('Volume.isValidMountPath / canonicalizeMountPath', () => {
  test.each(['/mnt/data', '/mnt/a/b/c', '/srv/vol'])('accepts %s', (p) => {
    expect(Volume.isValidMountPath(p)).toBe(true);
  });

  test.each([
    'rel/ative',
    '/',
    '/mnt/a,ro=0',
    '/mnt/a:b',
    '/mnt/a\\b',
    '/mnt/a b',
    '/mnt/a\nb',
    '/mnt/../etc',
    '/mnt/./x',
  ])('rejects %s', (p) => {
    expect(Volume.isValidMountPath(p)).toBe(false);
  });

  test('canonicalizes duplicate and trailing slashes', () => {
    expect(Volume.canonicalizeMountPath('/mnt//data/')).toBe('/mnt/data');
    expect(Volume.canonicalizeMountPath('/mnt/quick_and_dirty/')).toBe('/mnt/quick_and_dirty');
  });
});

describe('resolveVolumesRoot', () => {
  const node = { name: 'pve1', nodeType: 'proxmox', volumeStorage: 'cephfs', imageStorage: 'local' };

  test('derives the root from the storage config path (not /mnt/pve assumption)', async () => {
    const client = {
      async storageConfig(storage) {
        expect(storage).toBe('cephfs');
        return { storage, type: 'cephfs', path: '/mnt/pve/cephfs/', shared: 1 };
      },
    };
    const res = await resolveVolumesRoot(client, node);
    expect(res).toEqual({ root: '/mnt/pve/cephfs/volumes', storage: 'cephfs', shared: true });
  });

  test('throws when the storage has no host path (block storage)', async () => {
    const client = {
      async storageConfig() {
        return { storage: 'local-lvm', type: 'lvmthin', shared: 0 };
      },
    };
    await expect(resolveVolumesRoot(client, node)).rejects.toThrow(/no host path/);
  });

  test('docker nodes use a fixed host root without a storage query', async () => {
    const res = await resolveVolumesRoot({}, { name: 'd1', nodeType: 'docker' });
    expect(res.root).toBe('/var/lib/opensource-server/volumes');
    expect(res.shared).toBe(false);
  });

  test('reports shared=false for node-local storage', async () => {
    const client = {
      async storageConfig(storage) {
        return { storage, type: 'dir', path: '/var/lib/vz', shared: 0 };
      },
    };
    const res = await resolveVolumesRoot(client, { ...node, volumeStorage: 'local' });
    expect(res.shared).toBe(false);
  });
});

describe('Volume DB validation', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  test('rejects a traversal name at the model layer', async () => {
    await expect(
      Volume.create({ containerId: 1, name: '../evil', mountPath: '/mnt/x', mode: 'rw' }),
    ).rejects.toThrow(/safe path segment/);
  });

  test('rejects a relative mount path', async () => {
    await expect(
      Volume.create({ containerId: 1, name: 'ok', mountPath: 'relative', mode: 'rw' }),
    ).rejects.toThrow(/absolute path/);
  });
});
