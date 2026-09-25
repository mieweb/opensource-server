/**
 * Node volume-storage shared-storage warnings (issue #421 (f)): saving a node
 * warns (does not block) when the volume storage is not path-backed, not
 * shared, or not active on every cluster node. Advisory only.
 */

const { volumeStorageWarnings } = require('../nodes');

function fakeNode(overrides = {}) {
  return {
    name: 'pve1',
    nodeType: 'proxmox',
    volumeStorage: 'cephfs',
    imageStorage: 'local',
    hasApiAccess: () => true,
    api: async () => overrides.client,
    ...overrides,
  };
}

describe('volumeStorageWarnings', () => {
  test('no warning for shared path-backed storage present on all nodes', async () => {
    const client = {
      async storageConfig() {
        return { storage: 'cephfs', type: 'cephfs', path: '/mnt/pve/cephfs', shared: 1 };
      },
      async clusterResources() {
        return [
          { storage: 'cephfs', node: 'pve1', status: 'available' },
          { storage: 'cephfs', node: 'pve2', status: 'available' },
        ];
      },
      async nodes() {
        return [{ node: 'pve1' }, { node: 'pve2' }];
      },
    };
    const warnings = await volumeStorageWarnings(fakeNode({ client }));
    expect(warnings).toEqual([]);
  });

  test('warns when storage is not shared', async () => {
    const client = {
      async storageConfig() {
        return { storage: 'local', type: 'dir', path: '/var/lib/vz', shared: 0 };
      },
      async clusterResources() {
        return [{ storage: 'local', node: 'pve1', status: 'available' }];
      },
      async nodes() {
        return [{ node: 'pve1' }];
      },
    };
    const warnings = await volumeStorageWarnings(fakeNode({ client, volumeStorage: 'local' }));
    expect(warnings.some((w) => /not marked shared/.test(w))).toBe(true);
  });

  test('warns when storage has no host path (block storage)', async () => {
    const client = {
      async storageConfig() {
        return { storage: 'local-lvm', type: 'lvmthin', shared: 0 };
      },
      async clusterResources() {
        return [];
      },
      async nodes() {
        return [{ node: 'pve1' }];
      },
    };
    const warnings = await volumeStorageWarnings(fakeNode({ client, volumeStorage: 'local-lvm' }));
    expect(warnings.some((w) => /no host path/.test(w))).toBe(true);
  });

  test('warns when storage is missing on some cluster nodes', async () => {
    const client = {
      async storageConfig() {
        return { storage: 'nfs1', type: 'nfs', path: '/mnt/nfs', shared: 1 };
      },
      async clusterResources() {
        return [{ storage: 'nfs1', node: 'pve1', status: 'available' }];
      },
      async nodes() {
        return [{ node: 'pve1' }, { node: 'pve2' }];
      },
    };
    const warnings = await volumeStorageWarnings(fakeNode({ client, volumeStorage: 'nfs1' }));
    expect(warnings.some((w) => /not present\/active on every node/.test(w))).toBe(true);
  });

  test('docker/dummy nodes are skipped', async () => {
    expect(await volumeStorageWarnings(fakeNode({ nodeType: 'docker' }))).toEqual([]);
    expect(await volumeStorageWarnings(fakeNode({ hasApiAccess: () => false }))).toEqual([]);
  });
});
