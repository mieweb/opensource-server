const { generateVmid, VMID_MIN, VMID_MAX } = require('../vmid');

describe('generateVmid', () => {
  it('stays within the Proxmox VMID range', () => {
    for (const now of [0, 999, Date.now(), 9998999, 9999000, Number.MAX_SAFE_INTEGER]) {
      for (let i = 0; i < 100; i++) {
        const vmid = generateVmid(now);
        expect(Number.isInteger(vmid)).toBe(true);
        expect(vmid).toBeGreaterThanOrEqual(VMID_MIN);
        expect(vmid).toBeLessThanOrEqual(VMID_MAX);
      }
    }
  });

  it('randomizes IDs allocated in the same second', () => {
    const now = Date.now();
    const ids = new Set(Array.from({ length: 1000 }, () => generateVmid(now)));
    // ~5 birthday collisions expected out of a 100000-wide random space
    expect(ids.size).toBeGreaterThan(980);
  });

  it('never collides across different seconds', () => {
    const now = Date.now();
    const a = Array.from({ length: 50 }, () => generateVmid(now));
    const b = Array.from({ length: 50 }, () => generateVmid(now + 1000));
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
});
