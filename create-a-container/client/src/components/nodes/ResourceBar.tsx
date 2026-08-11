import { Progress } from '@mieweb/ui';
import { formatBytes } from '@/lib/format';

function variantFor(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 90) return 'danger';
  if (pct >= 75) return 'warning';
  return 'success';
}

export interface ResourceBarProps {
  label: string;
  /** Amount in use (bytes for `bytes`, percent 0..100 for `percent`). */
  used: number;
  /** Capacity (bytes for `bytes`, 100 for `percent`). */
  total: number;
  format?: 'bytes' | 'percent';
}

/**
 * Labelled utilization bar (used / total) that colours by fill level: green
 * under 75%, amber under 90%, red at or above 90%.
 */
export function ResourceBar({ label, used, total, format = 'bytes' }: ResourceBarProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const formatValue = (value: number, max: number) =>
    format === 'percent'
      ? `${Math.round(max > 0 ? (value / max) * 100 : 0)}%`
      : `${formatBytes(value)} / ${formatBytes(max)}`;

  return (
    <Progress
      value={used}
      max={total > 0 ? total : 1}
      label={label}
      showValue
      formatValue={formatValue}
      variant={variantFor(pct)}
    />
  );
}
