import { useCallback, useEffect, useMemo } from 'react';
import { DataVisNitroGrid, DataVisNitroSource } from '@mieweb/ui/datavis';
import type { TableColumn, TableRendererProps } from '@mieweb/datavis';
import type { UsageOwner } from '@/lib/types';
import { formatBytes } from '@/lib/format';
import { OwnerContainersTable } from './OwnerContainersTable';
import { PressureBadge } from './PressureBadge';

// Numeric `*Used` fields drive sorting; formatCell renders "used / allocated".
const TYPE_INFO: { field: string; type: string }[] = [
  { field: 'owner', type: 'string' },
  { field: 'containerCount', type: 'number' },
  { field: 'cpuUsed', type: 'number' },
  { field: 'memUsed', type: 'number' },
  { field: 'diskUsed', type: 'number' },
  { field: 'diskReadBytes', type: 'number' },
  { field: 'netInBytes', type: 'number' },
  { field: 'pressureMax', type: 'number' },
];

const asOwner = (row: Record<string, unknown>) => row as unknown as UsageOwner;

type FormatCell = NonNullable<TableRendererProps['formatCell']>;
type DetailRow = NonNullable<TableRendererProps['renderDetailRow']>;

export interface UsageDataGridProps {
  owners: UsageOwner[];
}

/**
 * Per-owner usage rows (allocated alongside used, always) rendered with
 * DataVis NITRO. Each row expands to the owner's per-container detail.
 */
export function UsageDataGrid({ owners }: UsageDataGridProps) {
  const url = useMemo(() => {
    const payload = { typeInfo: TYPE_INFO, data: owners };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    return URL.createObjectURL(blob);
  }, [owners]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        field: 'owner',
        header: 'Owner',
        sortable: true,
        filterable: true,
        getSearchText: (_v, row) => asOwner(row).owner ?? 'unattributed',
      },
      {
        field: 'containerCount',
        header: 'Containers (running)',
        sortable: true,
        filterable: false,
        getSearchText: () => '',
      },
      { field: 'cpuUsed', header: 'CPU cores (used / alloc)', sortable: true, filterable: false, getSearchText: () => '' },
      { field: 'memUsed', header: 'Memory (used / alloc)', sortable: true, filterable: false, getSearchText: () => '' },
      { field: 'diskUsed', header: 'Disk (used / alloc)', sortable: true, filterable: false, getSearchText: () => '' },
      { field: 'diskReadBytes', header: 'Disk I/O (r / w)', sortable: true, filterable: false, getSearchText: () => '' },
      { field: 'netInBytes', header: 'Network (in / out)', sortable: true, filterable: false, getSearchText: () => '' },
      { field: 'pressureMax', header: 'Pressure', sortable: true, filterable: false, getSearchText: () => '' },
    ],
    [],
  );

  const formatCell = useCallback<FormatCell>((value, row, column) => {
    const o = asOwner(row);
    switch (column.field) {
      case 'owner':
        return o.owner ? (
          <span className="font-medium">{o.owner}</span>
        ) : (
          <span className="italic text-muted-foreground">unattributed</span>
        );
      case 'containerCount':
        return `${o.containerCount} (${o.runningCount})`;
      case 'cpuUsed':
        return `${o.cpuUsed.toFixed(2)} / ${o.cpuAlloc}`;
      case 'memUsed':
        return `${formatBytes(o.memUsed)} / ${formatBytes(o.memAlloc)}`;
      case 'diskUsed':
        return `${formatBytes(o.diskUsed)} / ${formatBytes(o.diskAlloc)}`;
      case 'diskReadBytes':
        return `${formatBytes(o.diskReadBytes)} / ${formatBytes(o.diskWriteBytes)}`;
      case 'netInBytes':
        return `${formatBytes(o.netInBytes)} / ${formatBytes(o.netOutBytes)}`;
      case 'pressureMax':
        return <PressureBadge value={o.pressureMax} />;
      default:
        return value as React.ReactNode;
    }
  }, []);

  const renderDetailRow = useCallback<DetailRow>(
    (row) => <OwnerContainersTable containers={asOwner(row.data).containers} />,
    [],
  );

  return (
    <DataVisNitroSource type="http" url={url}>
      <DataVisNitroGrid
        columns={columns}
        formatCell={formatCell}
        renderDetailRow={renderDetailRow}
        features={{
          stickyHeaders: true,
          columnResize: true,
          columnReorder: true,
          zebraStripe: true,
          rowMode: 'clipped',
        }}
        height="70vh"
      />
    </DataVisNitroSource>
  );
}
