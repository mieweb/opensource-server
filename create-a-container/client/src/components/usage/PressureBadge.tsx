export interface PressureBadgeProps {
  /** Worst PSI stall percentage (avg10), or null when not probed. */
  value: number | null;
}

/**
 * Colored PSI readout: the issue #440 evidence puts sustained full-stall
 * above 40 firmly in "thrashing" territory; 10+ is worth watching. Null
 * means the container was not probed this cycle (PSI probes are budget-capped),
 * not that it is healthy.
 */
export function PressureBadge({ value }: PressureBadgeProps) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const cls =
    value >= 40
      ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
      : value >= 10
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {value.toFixed(1)}%
    </span>
  );
}
