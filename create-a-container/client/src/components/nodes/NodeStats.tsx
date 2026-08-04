import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, Badge, Spinner } from '@mieweb/ui';
import { ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { Node } from '@/lib/types';
import { ResourceBar } from './ResourceBar';

/** Compact "3d 4h" style uptime. */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Expandable resource dashboard for a node. Fetched lazily (only mounts when the
 * row is expanded) and polled while open so the bars track live utilization.
 */
export function NodeStats({ siteId, node }: { siteId?: string; node: Node }) {
  const { data, isLoading, error } = useQuery({
    queryKey: keys.nodeStats(siteId!, node.id),
    queryFn: () => queries.getNodeStats(siteId!, node.id),
    enabled: !!siteId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{(error as ApiError).message}</AlertDescription>
      </Alert>
    );
  }

  if (!data || !data.available) {
    return (
      <Alert variant="info">
        <AlertDescription>
          Live statistics are unavailable for this node
          {node.nodeType === 'docker' ? ' (Docker host)' : ''}.
        </AlertDescription>
      </Alert>
    );
  }

  const cpuPct = data.cpu != null ? data.cpu * 100 : 0;

  return (
    <div className="flex flex-col gap-4 p-1">
      <div className="flex items-center gap-2">
        <Badge variant="success">{data.status === 'online' ? 'Online' : (data.status ?? 'Online')}</Badge>
        {data.uptime != null && (
          <span className="text-xs text-muted-foreground">Uptime: {formatUptime(data.uptime)}</span>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <ResourceBar
          label={`CPU${data.cpuCount ? ` (${data.cpuCount} cores)` : ''}`}
          used={cpuPct}
          total={100}
          format="percent"
        />
        {data.memory && <ResourceBar label="Memory" used={data.memory.used} total={data.memory.total} />}
        {data.swap && data.swap.total > 0 && (
          <ResourceBar label="Swap" used={data.swap.used} total={data.swap.total} />
        )}
        {data.rootfs && <ResourceBar label="Root FS" used={data.rootfs.used} total={data.rootfs.total} />}
      </div>

      {data.storages.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Storage
          </span>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.storages.map((s) => (
              <ResourceBar key={s.name} label={s.name} used={s.used} total={s.total} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
