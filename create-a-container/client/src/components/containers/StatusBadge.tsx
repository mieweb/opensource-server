import { Badge } from '@mieweb/ui';
import type { ContainerStatus } from '@/lib/types';

// Human-readable labels for the live status values.
export const STATUS_LABELS: Record<ContainerStatus, string> = {
  running: 'Running',
  offline: 'Offline',
  creating: 'Creating',
  failed: 'Failed',
  missing: 'Missing',
  unknown: 'Unknown',
};

function statusVariant(
  s: ContainerStatus,
): 'default' | 'success' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'running':
      return 'success';
    case 'creating':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'offline':
    case 'missing':
      return 'secondary';
    default:
      return 'default';
  }
}

/** Status badge. The status is the live value embedded in the list response. */
export function StatusBadge({ status }: { status: ContainerStatus }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABELS[status] ?? status}</Badge>;
}
