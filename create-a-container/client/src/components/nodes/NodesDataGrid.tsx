import { useCallback, useEffect, useMemo } from 'react';
import { DataVisNitroGrid, DataVisNitroSource } from '@mieweb/ui/datavis';
import type { TableColumn, TableRendererProps } from '@mieweb/datavis';
import type { Node } from '@/lib/types';
import { CredentialsBadge } from './CredentialsBadge';
import { NvidiaBadge } from './NvidiaBadge';
import { NodeRowActions } from './NodeRowActions';
import { NodeStats } from './NodeStats';

// Field types for the DataVis source payload; custom-rendered columns
// (credentials/actions) are omitted and supply their own search text.
const TYPE_INFO: { field: string; type: string }[] = [
  { field: 'name', type: 'string' },
  { field: 'ipv4Address', type: 'string' },
  { field: 'apiUrl', type: 'string' },
  { field: 'nvidiaAvailable', type: 'string' },
];

const asNode = (row: Record<string, unknown>) => row as unknown as Node;

type FormatCell = NonNullable<TableRendererProps['formatCell']>;
type DetailRow = NonNullable<TableRendererProps['renderDetailRow']>;

export interface NodesDataGridProps {
  nodes: Node[];
  siteId?: string;
  onDelete: (id: number) => void;
  deleting: boolean;
}

/**
 * Nodes list rendered with DataVis NITRO. Each row has a disclosure toggle that
 * expands a full-width detail row (`NodeStats`) with live hardware-utilization
 * bars. Rows are fed to the grid through an in-memory blob URL.
 */
export function NodesDataGrid({ nodes, siteId, onDelete, deleting }: NodesDataGridProps) {
  const url = useMemo(() => {
    const payload = { typeInfo: TYPE_INFO, data: nodes };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    return URL.createObjectURL(blob);
  }, [nodes]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const columns = useMemo<TableColumn[]>(
    () => [
      { field: 'name', header: 'Name', sortable: true, filterable: true },
      { field: 'ipv4Address', header: 'IPv4', sortable: true, filterable: true },
      { field: 'apiUrl', header: 'API URL', sortable: true, filterable: true },
      {
        field: 'nvidiaAvailable',
        header: 'NVIDIA',
        sortable: true,
        filterable: true,
        getSearchText: (_v, row) => (asNode(row).nvidiaAvailable ? 'Available' : 'No'),
      },
      {
        field: 'credentials',
        header: 'Credentials',
        sortable: false,
        filterable: false,
        getSearchText: () => '',
      },
      {
        field: 'actions',
        header: '',
        sortable: false,
        filterable: false,
        resizable: false,
        reorderable: false,
        align: 'right',
        getSearchText: () => '',
      },
    ],
    [],
  );

  const formatCell = useCallback<FormatCell>(
    (value, row, column) => {
      const n = asNode(row);
      switch (column.field) {
        case 'name':
          return <span className="font-medium">{n.name}</span>;
        case 'ipv4Address':
          return <span className="font-mono text-xs">{n.ipv4Address || '—'}</span>;
        case 'apiUrl':
          return (
            <span className="break-all font-mono text-xs" title={n.apiUrl || undefined}>
              {n.apiUrl || '—'}
            </span>
          );
        case 'nvidiaAvailable':
          return <NvidiaBadge n={n} />;
        case 'credentials':
          return <CredentialsBadge n={n} />;
        case 'actions':
          return (
            <div className="flex flex-wrap items-center justify-end gap-1">
              <NodeRowActions n={n} siteId={siteId} onDelete={onDelete} deleting={deleting} />
            </div>
          );
        default:
          return value as React.ReactNode;
      }
    },
    [siteId, onDelete, deleting],
  );

  const renderDetailRow = useCallback<DetailRow>(
    (row) => <NodeStats siteId={siteId} node={asNode(row.data)} />,
    [siteId],
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
