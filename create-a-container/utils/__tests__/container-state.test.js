const {
  computeDesiredState,
  diffState,
  applyDiff,
  toLxcConfig,
  parseRootfsSizeGb,
  NVIDIA_HOOKSCRIPT,
} = require('../container-state');

const DEFAULTS = { memory: 8192, swap: 0, cpus: 4, rootfs: 50 };
const node = { name: 'pve1', networkBridge: 'vmbr0' };
const site = { id: 1, internalDomain: 'example.internal' };
const container = { hostname: 'web', username: 'alice', nvidiaRequested: false };

function desiredWith(overrides = {}) {
  return computeDesiredState({
    container,
    node,
    site,
    resourceDefaults: DEFAULTS,
    approved: {},
    envConfig: { env: 'A=1\0B=2', entrypoint: '/sbin/init' },
    ...overrides,
  });
}

/** A current config that exactly matches desiredWith() defaults. */
function matchingCurrent(extra = {}) {
  return {
    config: {
      cores: 4,
      memory: 8192,
      swap: 0,
      features: 'keyctl=1,nesting=1,fuse=1',
      net0: 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:00:01,ip=dhcp,type=veth',
      searchdomain: 'example.internal',
      onboot: 1,
      tags: 'alice',
      env: 'B=2\0A=1',
      entrypoint: '/sbin/init',
      rootfs: 'local-lvm:vm-100-disk-0,size=50G',
      ...extra,
    },
    rootfsGb: parseRootfsSizeGb(extra.rootfs || 'size=50G'),
  };
}

const ops = (...a) => diffState(...a).ops;

describe('container-state', () => {
  test('identical state produces an empty diff', () => {
    expect(ops(desiredWith(), matchingCurrent())).toHaveLength(0);
  });

  test('changed default memory is applied to an old container', () => {
    const result = ops(desiredWith(), matchingCurrent({ memory: 4096 }));
    expect(result).toEqual([{ key: 'memory', op: 'set', from: 4096, to: 8192 }]);
  });

  test('approved values override defaults and approved swap=0 is respected', () => {
    const d = desiredWith({ resourceDefaults: { ...DEFAULTS, swap: 512 }, approved: { memory: 16384, swap: 0 } });
    expect(d.config.memory).toBe(16384);
    expect(d.config.swap).toBe(0);
  });

  test('nonpositive memory/cpus/rootfs approvals fall back to defaults; swap=0 kept', () => {
    const d = desiredWith({ approved: { memory: 0, cpus: -1, rootfs: 0, swap: 0 } });
    expect(d.config.memory).toBe(8192);
    expect(d.config.cores).toBe(4);
    expect(d.rootfsGb).toBe(50);
    expect(d.config.swap).toBe(0);
  });

  test('env/entrypoint changes and deletes', () => {
    const d = desiredWith({ envConfig: { env: 'A=1', delete: 'entrypoint' } });
    const result = ops(d, matchingCurrent());
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'env', op: 'set', to: 'A=1' }),
        expect.objectContaining({ key: 'entrypoint', op: 'delete' }),
      ]),
    );
  });

  test('mounts are added and detached mounts deleted, legacy slots preserved', () => {
    const d = desiredWith({ mounts: { mp1: '/data/x,mp=/x' }, reservedMounts: 1 });
    const result = ops(d, matchingCurrent({ mp0: '/legacy,mp=/q', mp2: '/old,mp=/old' }));
    expect(result).toEqual(
      expect.arrayContaining([
        { key: 'mp1', op: 'set', from: undefined, to: '/data/x,mp=/x' },
        expect.objectContaining({ key: 'mp2', op: 'delete' }),
      ]),
    );
    expect(result.find((o) => o.key === 'mp0')).toBeUndefined();
  });

  test('hookscript added when nvidia requested and removed when not', () => {
    const on = desiredWith({ container: { ...container, nvidiaRequested: true } });
    expect(ops(on, matchingCurrent())).toEqual([
      { key: 'hookscript', op: 'set', from: undefined, to: NVIDIA_HOOKSCRIPT },
    ]);
    const off = ops(desiredWith(), matchingCurrent({ hookscript: NVIDIA_HOOKSCRIPT }));
    expect(off).toEqual([{ key: 'hookscript', op: 'delete', from: NVIDIA_HOOKSCRIPT, to: null }]);
  });

  test('net0 rewrite preserves hwaddr', () => {
    const result = ops(
      desiredWith({ node: { ...node, networkBridge: 'vmbr1' } }),
      matchingCurrent(),
    );
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('net0');
    expect(result[0].to).toContain('hwaddr=BC:24:11:00:00:01');
    expect(result[0].to).toContain('bridge=vmbr1');
  });

  test('rootfs grow becomes a resize; shrink throws', () => {
    const grow = ops(desiredWith({ approved: { rootfs: 80 } }), matchingCurrent());
    expect(grow).toEqual([{ key: 'rootfs', op: 'resize', from: 50, to: 80 }]);
    expect(() => ops(desiredWith({ approved: { rootfs: 20 } }), matchingCurrent())).toThrow(/shrink/);
  });

  test('keys unsupported by the client are skipped', () => {
    const client = { supportsConfigKey: (k) => ['cores', 'memory', 'env', 'entrypoint'].includes(k) };
    const r = diffState(desiredWith(), { config: { cores: 4, memory: 4096, env: 'A=1\0B=2', entrypoint: '/sbin/init' }, rootfsGb: null }, client);
    expect(r.ops).toEqual([{ key: 'memory', op: 'set', from: 4096, to: 8192 }]);
    expect(r.skipped).toEqual(expect.arrayContaining(['swap', 'features', 'net0', 'hookscript']));
  });

  test('applyDiff batches sets/deletes, resizes, and reports docker recreate id', async () => {
    const client = {
      updateLxcConfig: jest.fn().mockResolvedValue('docker:recreate:newid'),
      resizeLxcDisk: jest.fn().mockResolvedValue('UPID:x'),
      waitForTask: jest.fn().mockResolvedValue(),
    };
    const newId = await applyDiff(client, node, 'oldid', [
      { key: 'memory', op: 'set', to: 8192 },
      { key: 'hookscript', op: 'delete' },
      { key: 'rootfs', op: 'resize', from: 50, to: 80 },
    ]);
    expect(client.updateLxcConfig).toHaveBeenCalledWith('pve1', 'oldid', { memory: 8192, delete: 'hookscript' });
    expect(client.resizeLxcDisk).toHaveBeenCalledWith('pve1', 'newid', 'rootfs', '80G');
    expect(newId).toBe('newid');
  });

  test('toLxcConfig exposes only create-time keys', () => {
    expect(Object.keys(toLxcConfig(desiredWith())).sort()).toEqual(
      ['cores', 'features', 'memory', 'net0', 'onboot', 'searchdomain', 'swap', 'tags'],
    );
  });
});
