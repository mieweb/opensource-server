/**
 * Housekeeping for open registration: drop expired records (tokens, codes,
 * interactions), grants nothing can
 * use anymore, and dynamically registered clients that never got (or lost)
 * a grant. Runs opportunistically from /oauth/register, at most hourly.
 */

const repo = require('../repository');
const { UNUSED_CLIENT_TTL_MS } = require('./policy');

const INTERVAL_MS = 60 * 60 * 1000;
let lastRun = 0;

async function sweep(now = new Date()) {
  const expired = await repo.destroyExpired(now);
  const grants = await repo.destroyDeadGrants();
  const clients = await repo.destroyUnusedDynamicClients(new Date(now.getTime() - UNUSED_CLIENT_TTL_MS));
  return { expired, grants, clients };
}

/** Fire-and-forget sweep, throttled. Never throws. */
function maybeSweep() {
  const now = Date.now();
  if (now - lastRun < INTERVAL_MS) return;
  lastRun = now;
  sweep().catch((err) => console.error('OAuth sweep failed:', err));
}

module.exports = { sweep, maybeSweep };
