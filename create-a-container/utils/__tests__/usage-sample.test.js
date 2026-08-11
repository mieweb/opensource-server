'use strict';

const { parseOwnerTag, cpuCoresUsed, buildUsageSample } = require('../usage-sample');

describe('parseOwnerTag', () => {
  test('returns the single tag as owner', () => {
    expect(parseOwnerTag('horner')).toBe('horner');
  });

  test('returns the first tag of a semicolon-separated list', () => {
    expect(parseOwnerTag('cmyers;gpu;prod')).toBe('cmyers');
  });

  test('skips empty leading segments and trims whitespace', () => {
    expect(parseOwnerTag('; rgara ;x')).toBe('rgara');
  });

  test('returns null for missing or non-string tags', () => {
    expect(parseOwnerTag(undefined)).toBeNull();
    expect(parseOwnerTag(null)).toBeNull();
    expect(parseOwnerTag('')).toBeNull();
    expect(parseOwnerTag(';;')).toBeNull();
    expect(parseOwnerTag(42)).toBeNull();
  });
});

describe('cpuCoresUsed', () => {
  test('converts the utilization fraction to cores', () => {
    expect(cpuCoresUsed(0.5, 4)).toBe(2);
    expect(cpuCoresUsed(0, 8)).toBe(0);
  });

  test('returns null when either input is missing', () => {
    expect(cpuCoresUsed(undefined, 4)).toBeNull();
    expect(cpuCoresUsed(0.5, undefined)).toBeNull();
  });
});

describe('buildUsageSample', () => {
  const node = { name: 'pve2', siteId: 3 };
  const resource = {
    vmid: 284,
    name: 'ozwell-studio-92e3d441',
    node: 'pve2',
    status: 'running',
    tags: 'zbarrell',
    cpu: 0.25,
    maxcpu: 4,
    mem: 4262461440,
    maxmem: 4294967296,
    disk: 10737418240,
    maxdisk: 53687091200,
    diskread: 1000,
    diskwrite: 2000,
    netin: 3000,
    netout: 4000,
    uptime: 86400,
  };

  test('maps all fields from a cluster-resources entry', () => {
    const container = { id: 11, username: 'zbarrell' };
    const { sample, finding } = buildUsageSample({ resource, node, container });

    expect(finding).toBeNull();
    expect(sample).toEqual({
      vmid: '284',
      name: 'ozwell-studio-92e3d441',
      owner: 'zbarrell',
      node: 'pve2',
      siteId: 3,
      status: 'running',
      cpuUsed: 1,
      cpuAlloc: 4,
      memUsed: 4262461440,
      memAlloc: 4294967296,
      diskUsed: 10737418240,
      diskAlloc: 53687091200,
      diskReadBytes: 1000,
      diskWriteBytes: 2000,
      netInBytes: 3000,
      netOutBytes: 4000,
      uptime: 86400,
    });
  });

  test('reports drift when tag and DB owner disagree; tag wins', () => {
    const container = { id: 11, username: 'someoneelse' };
    const { sample, finding } = buildUsageSample({ resource, node, container });

    expect(sample.owner).toBe('zbarrell');
    expect(finding).toEqual({
      kind: 'drift',
      vmid: '284',
      tagOwner: 'zbarrell',
      dbOwner: 'someoneelse',
    });
  });

  test('falls back to the DB owner when the container is untagged', () => {
    const untagged = { ...resource, tags: undefined };
    const container = { id: 11, username: 'cmyers' };
    const { sample, finding } = buildUsageSample({ resource: untagged, node, container });

    expect(sample.owner).toBe('cmyers');
    expect(finding).toBeNull();
  });

  test('flags unattributed containers (no tag, not in DB)', () => {
    const untagged = { ...resource, tags: undefined };
    const { sample, finding } = buildUsageSample({ resource: untagged, node, container: null });

    expect(sample.owner).toBeNull();
    expect(finding).toEqual({
      kind: 'unattributed',
      vmid: '284',
      tagOwner: null,
      dbOwner: null,
    });
  });

  test('maps absent metrics to null (sparse sources like DummyApi)', () => {
    const sparse = { vmid: '5', node: 'dummy', status: 'running', tags: 'cmyers' };
    const { sample } = buildUsageSample({ resource: sparse, node, container: null });

    expect(sample.cpuUsed).toBeNull();
    expect(sample.cpuAlloc).toBeNull();
    expect(sample.memUsed).toBeNull();
    expect(sample.diskReadBytes).toBeNull();
    expect(sample.uptime).toBeNull();
    expect(sample.name).toBeNull();
    expect(sample.status).toBe('running');
  });
});
