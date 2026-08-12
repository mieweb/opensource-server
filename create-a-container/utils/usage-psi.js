'use strict';

/**
 * usage-psi.js — pure helpers for PSI (pressure stall information) collection
 * (issue #440, tier 2).
 *
 * Proxmox exports per-container PSI through `rrddata` — but that is one API
 * call per container, so the fleet is never swept. Each cycle probes only the
 * containers most likely to be under pressure (highest memory/CPU utilization
 * relative to their allocation), capped at a fixed budget. Raw stats miss
 * exactly the incidents PSI catches (a container at 99% memory can be healthy;
 * one at 99% with psiMemFull > 40 is thrashing), which is why the report
 * carries both.
 *
 * No I/O here — candidate selection and RRD parsing are pure so they are
 * trivially unit-tested; utils/usage-collection.js owns the API calls.
 */

/** RRD field -> sample field for the six PSI series. */
const PSI_FIELDS = {
  pressurecpusome: 'psiCpuSome',
  pressurecpufull: 'psiCpuFull',
  pressurememorysome: 'psiMemSome',
  pressurememoryfull: 'psiMemFull',
  pressureiosome: 'psiIoSome',
  pressureiofull: 'psiIoFull',
};

/**
 * Utilization score used to prioritize PSI probes: the worst of memory and
 * CPU usage as a fraction of allocation. Containers without usable ratios
 * score 0 (still probed when the budget allows).
 * @param {object} sample - Normalized sample (utils/usage-sample.js)
 * @returns {number}
 */
function utilizationScore(sample) {
  const mem = sample.memAlloc > 0 && sample.memUsed != null ? sample.memUsed / sample.memAlloc : 0;
  const cpu = sample.cpuAlloc > 0 && sample.cpuUsed != null ? sample.cpuUsed / sample.cpuAlloc : 0;
  return Math.max(mem, cpu);
}

/**
 * Pick which running containers to probe for PSI this cycle, ordered by
 * utilization score (highest first) and capped at `limit`.
 * @param {Array<object>} samples - Normalized samples
 * @param {number} limit - Probe budget for the cycle
 * @returns {Array<object>} Subset of samples to probe
 */
function selectPsiCandidates(samples, limit) {
  if (limit <= 0) return [];
  return samples
    .filter((s) => s.status === 'running')
    .sort((a, b) => utilizationScore(b) - utilizationScore(a))
    .slice(0, limit);
}

/**
 * Extract the most recent PSI readings from an rrddata series. RRD rows may
 * trail off with nulls, so the scan walks backwards and takes the newest
 * non-null value per field.
 * @param {Array<object>|null|undefined} rows - rrddata response (oldest first)
 * @returns {object|null} `{ psiCpuSome, ..., psiIoFull }` (each number|null),
 *   or null when the series has no PSI data at all
 */
function latestPsi(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const psi = {};
  let found = false;
  for (const [rrdField, sampleField] of Object.entries(PSI_FIELDS)) {
    psi[sampleField] = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const value = rows[i]?.[rrdField];
      if (typeof value === 'number' && Number.isFinite(value)) {
        psi[sampleField] = value;
        found = true;
        break;
      }
    }
  }
  return found ? psi : null;
}

module.exports = { selectPsiCandidates, latestPsi, PSI_FIELDS };
