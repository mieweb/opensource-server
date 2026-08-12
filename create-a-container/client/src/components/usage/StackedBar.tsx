export interface StackedBarSegment {
  label: string;
  value: number;
  color: string;
}

export interface StackedBarProps {
  /** e.g. "Memory" */
  title: string;
  segments: StackedBarSegment[];
  /** Physical capacity the bar is drawn against. */
  capacity: number;
  format: (value: number) => string;
}

/**
 * Horizontal stacked bar: one colored segment per owner, drawn against
 * cluster capacity so the empty remainder is visible headroom. When the
 * segments exceed capacity (over-commit) the scale grows to fit and a
 * capacity tick marks 100%.
 */
export function StackedBar({ title, segments, capacity, format }: StackedBarProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const scale = Math.max(capacity, total);
  if (scale <= 0) return null;
  const capacityPct = (capacity / scale) * 100;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {format(total)} / {format(capacity)}
          {capacity > 0 && ` (${Math.round((total / capacity) * 100)}%)`}
        </span>
      </div>
      <div
        className="relative flex h-6 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-700"
        role="img"
        aria-label={`${title}: ${format(total)} used of ${format(capacity)} capacity`}
      >
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full"
            style={{ width: `${(s.value / scale) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${format(s.value)}`}
          />
        ))}
        {total > capacity && capacity > 0 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-red-600"
            style={{ left: `${capacityPct}%` }}
            title={`Capacity: ${format(capacity)}`}
          />
        )}
      </div>
    </div>
  );
}
