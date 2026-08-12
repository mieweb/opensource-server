import { useMemo } from 'react';
import type { UsageOwner, UsageReport } from '@/lib/types';
import { formatBytes } from '@/lib/format';
import { StackedBar, type StackedBarSegment } from './StackedBar';

/**
 * Deterministic owner colors: distinct hues for the top consumers, gray for
 * the aggregated remainder.
 */
const PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea',
  '#0891b2', '#db2777', '#65a30d', '#7c3aed', '#ea580c',
];
const OTHERS_COLOR = '#9ca3af';
const OTHERS_LABEL = 'others';
const TOP_OWNERS = PALETTE.length;

/**
 * One color per owner across every bar (ranked by memory use — the metric
 * people get yelled at for); owners beyond the palette share a gray
 * "others" bucket.
 */
function buildColorMap(owners: UsageOwner[]): Map<string, string> {
  const ranked = [...owners].sort((a, b) => b.memUsed - a.memUsed);
  const map = new Map<string, string>();
  ranked.forEach((o, i) => {
    if (i < TOP_OWNERS) map.set(o.owner ?? 'unattributed', PALETTE[i]);
  });
  return map;
}

function segmentsFor(
  owners: UsageOwner[],
  metric: (o: UsageOwner) => number,
  colorMap: Map<string, string>,
): StackedBarSegment[] {
  const named: StackedBarSegment[] = [];
  let othersValue = 0;
  let othersCount = 0;

  for (const o of owners) {
    const value = metric(o);
    if (value <= 0) continue;
    const label = o.owner ?? 'unattributed';
    const color = colorMap.get(label);
    if (color) {
      named.push({ label, value, color });
    } else {
      othersValue += value;
      othersCount++;
    }
  }

  named.sort((a, b) => b.value - a.value);
  if (othersValue > 0) {
    named.push({ label: `${othersCount} ${OTHERS_LABEL}`, value: othersValue, color: OTHERS_COLOR });
  }
  return named;
}

const formatCores = (v: number) => `${v.toFixed(1)} cores`;

export interface UsageStackedBarsProps {
  report: UsageReport;
}

/**
 * Cluster-wide used-vs-capacity stacked bars for CPU and memory, one colored
 * segment per owner — the "who is using the cluster" view. A shared legend
 * covers both bars.
 */
export function UsageStackedBars({ report }: UsageStackedBarsProps) {
  const { owners, capacity } = report;

  const colorMap = useMemo(() => buildColorMap(owners), [owners]);
  const cpuSegments = useMemo(() => segmentsFor(owners, (o) => o.cpuUsed, colorMap), [owners, colorMap]);
  const memSegments = useMemo(() => segmentsFor(owners, (o) => o.memUsed, colorMap), [owners, colorMap]);

  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of [...memSegments, ...cpuSegments]) {
      if (!seen.has(s.label)) seen.set(s.label, s.color);
    }
    return [...seen.entries()];
  }, [cpuSegments, memSegments]);

  if (capacity.cpuCores <= 0 && capacity.memBytes <= 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <StackedBar
        title="Memory (used, by owner)"
        segments={memSegments}
        capacity={capacity.memBytes}
        format={formatBytes}
      />
      <StackedBar
        title="CPU (cores in use, by owner)"
        segments={cpuSegments}
        capacity={capacity.cpuCores}
        format={formatCores}
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Owner legend">
        {legend.map(([label, color]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
