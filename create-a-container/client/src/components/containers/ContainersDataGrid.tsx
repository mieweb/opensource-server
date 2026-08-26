import { useCallback, useEffect, useMemo } from 'react';
import { DataVisNitroGrid, DataVisNitroSource } from '@mieweb/ui/datavis';
import type { ColumnFilterConfig, TableColumn, TableRendererProps } from '@mieweb/datavis';
import { User } from 'lucide-react';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import type { Container } from '@/lib/types';
import { HttpLinks } from './HttpLinks';
import { NodeLink } from './NodeLink';
import { RowActions } from './RowActions';
import { SshLinks } from './SshLinks';
import { STATUS_LABELS, StatusBadge } from './StatusBadge';
import { DefaultOwnerFilter } from './DefaultOwnerFilter';
import { templateTitle } from './shared';

export interface ContainersDataGridProps {
  containers: Container[];
  sessionUser?: string;
  siteId?: string;
  onDelete: (id: number) => void;
  deleting: boolean;
  canShare: (c: Container) => boolean;
  onShare: (c: Container) => void;
}

// Field types for the DataVis source payload. Custom-rendered columns
// (HTTP/SSH/actions) are omitted; their search text is supplied per-column.
const TYPE_INFO: { field: string; type: string }[] = [
  { field: 'hostname', type: 'string' },
  { field: 'status', type: 'string' },
  { field: 'nodeName', type: 'string' },
  { field: 'owner', type: 'string' },
  { field: 'template', type: 'string' },
  { field: 'lastAccessedAt', type: 'string' },
];

const asContainer = (row: Record<string, unknown>) => row as unknown as Container;

type FormatCell = NonNullable<TableRendererProps['formatCell']>;

/**
 * Containers list rendered with DataVis NITRO. Rows are fed to the grid through
 * an in-memory blob URL (the library's `http` source), and the custom cells
 * (status badge, node/HTTP/SSH links, row actions) are rendered via `formatCell`.
 */
export function ContainersDataGrid({
  containers,
  sessionUser,
  siteId,
  onDelete,
  deleting,
  canShare,
  onShare,
}: ContainersDataGridProps) {
  // DataVis's `http` source fetches a URL; a blob URL lets us feed local React
  // Query data without a network round-trip. Rebuilt whenever the rows change.
  const url = useMemo(() => {
    const payload = { typeInfo: TYPE_INFO, data: containers };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    return URL.createObjectURL(blob);
  }, [containers]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const columns = useMemo<TableColumn[]>(
    () => [
      { field: 'hostname', header: 'Hostname', sortable: true, filterable: true },
      {
        field: 'status',
        header: 'Status',
        sortable: true,
        filterable: true,
        getSearchText: (_v, row) => {
          const c = asContainer(row);
          return STATUS_LABELS[c.status] ?? c.status;
        },
      },
      { field: 'nodeName', header: 'Node', sortable: true, filterable: true },
      { field: 'owner', header: 'User', sortable: true, filterable: true },
      {
        field: 'template',
        header: 'Template',
        sortable: true,
        filterable: true,
        getSearchText: (_v, row) => templateTitle(asContainer(row).template),
      },
      {
        field: 'httpEntries',
        header: 'HTTP',
        sortable: false,
        filterable: false,
        getSearchText: (_v, row) =>
          asContainer(row)
            .httpEntries.map((h) => h.externalUrl ?? `:${h.port}`)
            .join(' '),
      },
      {
        field: 'sshHost',
        header: 'SSH',
        sortable: false,
        filterable: false,
        getSearchText: (_v, row) => {
          const c = asContainer(row);
          return c.sshHost && c.sshPort ? `${c.sshHost}:${c.sshPort}` : '';
        },
      },
      {
        field: 'lastAccessedAt',
        header: 'Last Access',
        sortable: true,
        filterable: false,
        getSearchText: (_v, row) => formatRelativeTime(asContainer(row).lastAccessedAt),
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

  // The "User" column gets a dropdown filter listing the owners present in the
  // data, so users can narrow to their own, shared, or a specific user's
  // containers straight from the grid — no separate filter bar needed.
  const filterColumns = useMemo<ColumnFilterConfig[]>(() => {
    const owners = Array.from(new Set(containers.map((c) => c.owner))).sort((a, b) =>
      a.localeCompare(b),
    );
    return [
      {
        field: 'owner',
        displayName: 'User',
        filterType: 'string',
        widget: 'dropdown',
        options: owners,
      },
    ];
  }, [containers]);

  const formatCell = useCallback<FormatCell>(
    (value, row, column) => {
      const c = asContainer(row);
      switch (column.field) {
        case 'hostname':
          return <span className="font-medium">{c.hostname}</span>;
        case 'status':
          return <StatusBadge status={c.status} />;
        case 'nodeName':
          return <NodeLink c={c} />;
        case 'owner':
          return (
            <span className="inline-flex items-center gap-1">
              <User className="size-3.5" aria-hidden="true" />
              {c.owner}
            </span>
          );
        case 'template':
          return (
            <span className="font-mono text-xs" title={c.template || undefined}>
              {templateTitle(c.template)}
            </span>
          );
        case 'httpEntries':
          return <HttpLinks c={c} limit={2} />;
        case 'sshHost':
          return <SshLinks c={c} sessionUser={sessionUser} />;
        case 'actions':
          return (
            <div className="flex flex-wrap items-center justify-end gap-1">
              <RowActions
                c={c}
                siteId={siteId}
                onDelete={onDelete}
                deleting={deleting}
                canShare={canShare(c)}
                onShare={onShare}
              />
            </div>
          );
        case 'lastAccessedAt':
          return (
            <span title={c.lastAccessedAt ? new Date(c.lastAccessedAt).toLocaleString() : undefined}>
              {formatRelativeTime(c.lastAccessedAt)}
            </span>
          );
        default:
          return value as React.ReactNode;
      }
    },
    [sessionUser, siteId, onDelete, deleting, canShare, onShare],
  );

  return (
    <DataVisNitroSource type="http" url={url}>
      <DefaultOwnerFilter owner={sessionUser} />
      <DataVisNitroGrid
        columns={columns}
        filterColumns={filterColumns}
        formatCell={formatCell}
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
