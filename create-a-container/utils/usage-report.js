'use strict';

/**
 * usage-report.js — pure aggregation for the live per-owner usage report
 * (issue #440). Groups normalized samples (utils/usage-sample.js) by owner
 * with allocated-vs-used totals; the /sites/:siteId/usage endpoint owns
 * visibility filtering and serialization.
 */

const SUM_FIELDS = [
  'cpuUsed', 'cpuAlloc',
  'memUsed', 'memAlloc',
  'diskUsed', 'diskAlloc',
  'diskReadBytes', 'diskWriteBytes',
  'netInBytes', 'netOutBytes',
];

/**
 * Group usage samples by owner. Null owners collapse into a single
 * `owner: null` row (rendered as "unattributed" by callers). Absent metrics
 * (null) are excluded from sums rather than treated as zero.
 * @param {Array<object>} samples - Normalized samples from utils/usage-sample.js
 * @returns {Array<object>} One row per owner, sorted by owner name (null last):
 *   { owner, containerCount, runningCount, <summed metric fields>, containers }
 */
function aggregateByOwner(samples) {
  const byOwner = new Map();

  for (const sample of samples) {
    const key = sample.owner ?? null;
    let row = byOwner.get(key);
    if (!row) {
      row = { owner: key, containerCount: 0, runningCount: 0, containers: [] };
      for (const field of SUM_FIELDS) row[field] = 0;
      byOwner.set(key, row);
    }
    row.containerCount++;
    if (sample.status === 'running') row.runningCount++;
    for (const field of SUM_FIELDS) {
      if (sample[field] != null) row[field] += sample[field];
    }
    row.containers.push(sample);
  }

  return [...byOwner.values()].sort((a, b) => {
    if (a.owner === null) return 1;
    if (b.owner === null) return -1;
    return a.owner.localeCompare(b.owner);
  });
}

module.exports = { aggregateByOwner };
