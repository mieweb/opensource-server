'use strict';

const { selectPsiCandidates, latestPsi } = require('../usage-psi');

function sample(overrides = {}) {
  return {
    vmid: '100',
    status: 'running',
    cpuUsed: 0.1,
    cpuAlloc: 4,
    memUsed: 100,
    memAlloc: 1000,
    ...overrides,
  };
}

describe('selectPsiCandidates', () => {
  test('orders by worst utilization (memory or CPU fraction) and caps at the limit', () => {
    const low = sample({ vmid: 'low', memUsed: 100 });
    const hot = sample({ vmid: 'hot', memUsed: 950 });
    const cpuHot = sample({ vmid: 'cpuhot', cpuUsed: 3.6 });
    const mid = sample({ vmid: 'mid', memUsed: 500 });

    const picked = selectPsiCandidates([low, hot, cpuHot, mid], 2);
    expect(picked.map((s) => s.vmid)).toEqual(['hot', 'cpuhot']);
  });

  test('only probes running containers', () => {
    const stopped = sample({ vmid: 'stopped', status: 'stopped', memUsed: 999 });
    const running = sample({ vmid: 'running' });
    expect(selectPsiCandidates([stopped, running], 5).map((s) => s.vmid)).toEqual(['running']);
  });

  test('handles null metrics and a zero limit', () => {
    const sparse = sample({ vmid: 'sparse', cpuUsed: null, memUsed: null, memAlloc: null, cpuAlloc: null });
    expect(selectPsiCandidates([sparse], 5)).toEqual([sparse]);
    expect(selectPsiCandidates([sparse], 0)).toEqual([]);
  });
});

describe('latestPsi', () => {
  test('takes the newest non-null value per field', () => {
    const rows = [
      { time: 1, pressurememoryfull: 5, pressurecpusome: 1 },
      { time: 2, pressurememoryfull: 42, pressurecpusome: null },
    ];
    const psi = latestPsi(rows);
    expect(psi.psiMemFull).toBe(42);
    expect(psi.psiCpuSome).toBe(1); // newest row was null; falls back one row
    expect(psi.psiIoFull).toBeNull(); // never present
  });

  test('returns null when the series is empty or has no PSI fields', () => {
    expect(latestPsi([])).toBeNull();
    expect(latestPsi(null)).toBeNull();
    expect(latestPsi([{ time: 1, cpu: 0.5 }])).toBeNull();
  });
});
