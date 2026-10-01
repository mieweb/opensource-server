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

module.exports = { generateVmid, VMID_MIN, VMID_MAX };
