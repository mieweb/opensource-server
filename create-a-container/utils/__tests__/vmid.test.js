const { generateVmid, isVmidConflict, withVmidRetry, VMID_MIN, VMID_MAX } = require('../vmid');

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

describe('isVmidConflict', () => {
  it('detects Proxmox "already exists" errors', () => {
    const err = new Error('Request failed with status code 500');
    err.response = { statusText: "CT 123 already exists on node 'pve1'", data: {} };
    expect(isVmidConflict(err)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isVmidConflict(new Error('connection refused'))).toBe(false);
  });
});

describe('withVmidRetry', () => {
  const conflict = () => Object.assign(new Error('CT already exists'), {});
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('retries with a new VMID on conflict', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce('UPID:ok');
    const out = await withVmidRetry(100, fn, { generate: () => 200 });
    expect(out).toEqual({ vmid: 200, result: 'UPID:ok' });
    expect(fn.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it('does not retry unrelated errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(withVmidRetry(100, fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts', async () => {
    const fn = jest.fn().mockRejectedValue(conflict());
    await expect(withVmidRetry(100, fn, { maxAttempts: 3 })).rejects.toThrow('already exists');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
