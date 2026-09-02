import { Alert, AlertDescription } from '@mieweb/ui';
import type { UsageFinding } from '@/lib/types';

export interface AttributionWarningsProps {
  findings: UsageFinding[];
  /** Cluster members seen in Proxmox but not registered in the manager DB. */
  unknownNodeRows?: number;
}

/**
 * Admin-only warning banner for owner-attribution problems: drift between the
 * Proxmox owner tag and the manager DB, containers with no owner at all, and
 * cluster nodes the manager does not know about.
 */
export function AttributionWarnings({ findings, unknownNodeRows = 0 }: AttributionWarningsProps) {
  if (findings.length === 0 && unknownNodeRows === 0) return null;

  const drift = findings.filter((f) => f.kind === 'drift');
  const unattributed = findings.filter((f) => f.kind === 'unattributed');

  return (
    <Alert variant="warning" role="alert" aria-live="polite">
      <AlertDescription>
        <div className="flex flex-col gap-1">
          {drift.length > 0 && (
            <span>
              Attribution drift on {drift.length} container{drift.length === 1 ? '' : 's'}:{' '}
              {drift
                .map((f) => `CT ${f.vmid} (tag '${f.tagOwner}' ≠ DB '${f.dbOwner}')`)
                .join(', ')}
            </span>
          )}
          {unattributed.length > 0 && (
            <span>
              {unattributed.length} container{unattributed.length === 1 ? '' : 's'} with no owner
              (no Proxmox tag, not in the manager DB):{' '}
              {unattributed.map((f) => `CT ${f.vmid}`).join(', ')}
            </span>
          )}
          {unknownNodeRows > 0 && (
            <span>
              {unknownNodeRows} container{unknownNodeRows === 1 ? '' : 's'} on cluster nodes not
              registered in the manager.
            </span>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
