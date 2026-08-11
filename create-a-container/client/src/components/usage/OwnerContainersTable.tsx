import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mieweb/ui';
import type { UsageContainer } from '@/lib/types';
import { formatBytes } from '@/lib/format';

/** "left / right" pair where either side may be missing, e.g. used/alloc or read/write. */
function pair(
  left: number | null,
  right: number | null,
  format: (v: number) => string,
): string {
  const l = left != null ? format(left) : '—';
  const r = right != null ? format(right) : '—';
  return `${l} / ${r}`;
}

const cores = (v: number) => v.toFixed(2);

export interface OwnerContainersTableProps {
  containers: UsageContainer[];
}

/**
 * Per-container usage detail shown when an owner row in the usage grid is
 * expanded. I/O and network figures are cumulative since container boot.
 */
export function OwnerContainersTable({ containers }: OwnerContainersTableProps) {
  return (
    <div className="p-3">
      <Table responsive>
        <TableHeader>
          <TableRow>
            <TableHead>CT</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Node</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>CPU (cores)</TableHead>
            <TableHead>Memory</TableHead>
            <TableHead>Disk</TableHead>
            <TableHead>Disk I/O (r / w)</TableHead>
            <TableHead>Network (in / out)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((c) => (
            <TableRow key={c.vmid}>
              <TableCell className="font-mono text-sm">{c.vmid}</TableCell>
              <TableCell className="font-medium">{c.name || '—'}</TableCell>
              <TableCell>{c.node}</TableCell>
              <TableCell>{c.status || '—'}</TableCell>
              <TableCell>{pair(c.cpuUsed, c.cpuAlloc, cores)}</TableCell>
              <TableCell>{pair(c.memUsed, c.memAlloc, formatBytes)}</TableCell>
              <TableCell>{pair(c.diskUsed, c.diskAlloc, formatBytes)}</TableCell>
              <TableCell>{pair(c.diskReadBytes, c.diskWriteBytes, formatBytes)}</TableCell>
              <TableCell>{pair(c.netInBytes, c.netOutBytes, formatBytes)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
