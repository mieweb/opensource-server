'use strict';

const { aggregateByOwner } = require('../usage-report');

function sample(overrides = {}) {
  return {
    vmid: '100',
    name: 'ct-100',
    owner: 'cmyers',
    containerDbId: 1,
    node: 'pve1',
    siteId: 1,
    status: 'running',
    cpuUsed: 0.5,
    cpuAlloc: 4,
    memUsed: 1024,
    memAlloc: 4096,
    diskUsed: 10,
    diskAlloc: 50,
    diskReadBytes: 100,
    diskWriteBytes: 200,
    netInBytes: 300,
    netOutBytes: 400,
    uptime: 3600,
    ...overrides,
  };
}

describe('aggregateByOwner', () => {
  test('groups samples by owner and sums metrics', () => {
    const rows = aggregateByOwner([
      sample({ vmid: '100', cpuUsed: 0.5, cpuAlloc: 4, memUsed: 1000 }),
      sample({ vmid: '101', cpuUsed: 1.5, cpuAlloc: 2, memUsed: 2000, status: 'stopped' }),
      sample({ vmid: '102', owner: 'horner', cpuUsed: 3, cpuAlloc: 8 }),
    ]);

    expect(rows.map((r) => r.owner)).toEqual(['cmyers', 'horner']);

    const cmyers = rows[0];
    expect(cmyers.containerCount).toBe(2);
    expect(cmyers.runningCount).toBe(1);
    expect(cmyers.cpuUsed).toBe(2);
    expect(cmyers.cpuAlloc).toBe(6);
    expect(cmyers.memUsed).toBe(3000);
    expect(cmyers.containers.map((c) => c.vmid)).toEqual(['100', '101']);

    expect(rows[1].containerCount).toBe(1);
    expect(rows[1].cpuAlloc).toBe(8);
  });

  test('ignores null metrics instead of treating them as zero', () => {
    const rows = aggregateByOwner([
      sample({ cpuUsed: null, memUsed: null }),
      sample({ vmid: '101', cpuUsed: 1, memUsed: 500 }),
    ]);

    expect(rows[0].cpuUsed).toBe(1);
    expect(rows[0].memUsed).toBe(500);
    expect(rows[0].containerCount).toBe(2);
  });

  test('collapses unattributed samples into one null-owner row sorted last', () => {
    const rows = aggregateByOwner([
      sample({ owner: null, vmid: '200' }),
      sample({ owner: 'zbarrell', vmid: '201' }),
      sample({ owner: null, vmid: '202' }),
    ]);

    expect(rows.map((r) => r.owner)).toEqual(['zbarrell', null]);
    expect(rows[1].containerCount).toBe(2);
  });

  test('pressureMax is the worst PSI across the owner containers, null when unprobed', () => {
    const rows = aggregateByOwner([
      sample({ vmid: '100', psiMemFull: 42, psiIoSome: 5 }),
      sample({ vmid: '101', psiCpuSome: 7 }),
      sample({ vmid: '102', owner: 'horner' }),
    ]);

    expect(rows[0].pressureMax).toBe(42);
    expect(rows[1].pressureMax).toBeNull();
  });

  test('returns an empty array for no samples', () => {
    expect(aggregateByOwner([])).toEqual([]);
  });
});
