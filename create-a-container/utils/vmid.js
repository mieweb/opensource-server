const crypto = require('crypto');

// Proxmox accepts VMIDs in the range 100..999999999.
const VMID_MIN = 100;
const VMID_MAX = 999999999;

// UUIDv7-style layout squeezed into the VMID range: a coarse timestamp in the
// high digits and random bits in the low digits. IDs allocated in different
// seconds never collide within a time cycle, and concurrent allocations in the
// same second only collide with probability 1/RANDOM_SPACE. This replaces
// Proxmox's /cluster/nextid, which hands the same ID to concurrent callers.
const RANDOM_SPACE = 100000;
const TIME_SLOTS = Math.floor((VMID_MAX - VMID_MIN + 1) / RANDOM_SPACE);

/**
 * Generate a pseudo-random VMID that is safe to allocate without coordination.
 * @param {number} [now] - Epoch milliseconds (injectable for tests)
 * @returns {number}
 */
function generateVmid(now = Date.now()) {
  const timeSlot = Math.floor(now / 1000) % TIME_SLOTS;
  return VMID_MIN + timeSlot * RANDOM_SPACE + crypto.randomInt(RANDOM_SPACE);
}

/**
 * True if an error from a Proxmox create/clone call means the VMID is taken
 * (e.g. "CT 123 already exists on node 'pve1'").
 * @param {Error} err
 * @returns {boolean}
 */
function isVmidConflict(err) {
  const msg = [
    err?.response?.data?.message,
    err?.response?.statusText,
    err?.message,
  ].filter(Boolean).join(' ');
  return /already exists/i.test(msg);
}

/**
 * Run `fn(vmid)` and, if it fails because the VMID is already in use, retry
 * with a freshly generated VMID up to `maxAttempts` total attempts.
 * @template T
 * @param {number} vmid - Initial VMID to try
 * @param {(vmid: number) => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=5]
 * @param {() => number} [opts.generate=generateVmid]
 * @returns {Promise<{ vmid: number, result: T }>}
 */
async function withVmidRetry(vmid, fn, { maxAttempts = 5, generate = generateVmid } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { vmid, result: await fn(vmid) };
    } catch (err) {
      if (attempt >= maxAttempts || !isVmidConflict(err)) throw err;
      const next = generate();
      console.warn(`VMID ${vmid} already in use; retrying with ${next} (attempt ${attempt + 1}/${maxAttempts})`);
      vmid = next;
    }
  }
}

module.exports = { generateVmid, isVmidConflict, withVmidRetry, VMID_MIN, VMID_MAX };
