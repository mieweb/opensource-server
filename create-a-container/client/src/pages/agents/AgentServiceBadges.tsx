import { Badge } from '@mieweb/ui';
import type { AgentServiceStatus } from '@/lib/types';

function badgeVariant(status: AgentServiceStatus): 'success' | 'danger' | 'warning' {
  if (status.state !== 'active') return 'danger';
  if (status.lastApply === 'failure') return 'warning';
  return 'success';
}

/** One badge per managed service, e.g. "nginx: active" — red when the unit
 * isn't active, amber when the last config apply failed. */
export function AgentServiceBadges({
  services,
}: {
  services: Record<string, AgentServiceStatus> | null;
}) {
  const entries = Object.entries(services ?? {});
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([name, status]) => (
        <Badge
          key={name}
          variant={badgeVariant(status)}
          title={`state: ${status.state}, last apply: ${status.lastApply}`}
        >
          {name}: {status.state}
        </Badge>
      ))}
    </div>
  );
}
