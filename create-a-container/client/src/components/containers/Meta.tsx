import type { ReactNode } from 'react';

/** Inline labelled value used for container card metadata (Node, User, HTTP, …). */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs">{children}</span>
    </span>
  );
}
