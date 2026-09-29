/**
 * Docker volume mapping (issue #421): Proxmox mpN bind-mount config values are
 * translated to Docker HostConfig.Binds (`<hostPath>:<mountPath>[:ro]`).
 */

const { mpConfigToDockerBinds } = require('../docker-api');

describe('mpConfigToDockerBinds', () => {
  test('maps rw and ro mounts, ignores non-mp keys', () => {
    const binds = mpConfigToDockerBinds({
      cores: 4,
      mp0: '/srv/volumes/web/data,mp=/mnt/data,ro=0',
      mp1: '/srv/volumes/shared/quick_and_dirty,mp=/mnt/quick_and_dirty,ro=1',
      env: 'FOO=bar',
    });
    expect(binds).toEqual([
      '/srv/volumes/web/data:/mnt/data',
      '/srv/volumes/shared/quick_and_dirty:/mnt/quick_and_dirty:ro',
    ]);
  });

  test('returns empty for config without mp keys', () => {
    expect(mpConfigToDockerBinds({ cores: 2, memory: 512 })).toEqual([]);
  });

  test('skips malformed mp entries missing mp=', () => {
    expect(mpConfigToDockerBinds({ mp0: '/only/host/path' })).toEqual([]);
  });
});
