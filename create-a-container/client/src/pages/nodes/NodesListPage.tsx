import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardTitle,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@mieweb/ui';
import { Download, LayoutGrid, Pencil, Plus, Rows3, Server, Trash2 } from 'lucide-react';
import { ButtonLink } from '@/components/ButtonLink';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { Node } from '@/lib/types';

type ViewMode = 'cards' | 'table';
const VIEW_STORAGE_KEY = 'nodes:view';

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs">{children}</span>
    </span>
  );
}

function NvidiaBadge({ n }: { n: Node }) {
  return n.nvidiaAvailable ? (
    <Badge variant="success">Available</Badge>
  ) : (
    <Badge variant="secondary">No</Badge>
  );
}

function CredentialsBadge({ n }: { n: Node }) {
  return n.hasSecret ? <Badge variant="success">Set</Badge> : <Badge variant="warning">Missing</Badge>;
}

function RowActions({
  n,
  siteId,
  onDelete,
  deleting,
}: {
  n: Node;
  siteId?: string;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  return (
    <>
      <ButtonLink
        as={Link}
        to={`/sites/${siteId}/nodes/${n.id}/edit`}
        variant="ghost"
        size="sm"
        aria-label="Edit"
        leftIcon={<Pencil className="size-4" />}
      >
        <span className="hidden sm:inline">Edit</span>
      </ButtonLink>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Delete"
        leftIcon={<Trash2 className="size-4" />}
        onClick={() => {
          if (confirm(`Delete node "${n.name}"?`)) onDelete(n.id);
        }}
        disabled={deleting}
      >
        <span className="hidden sm:inline">Delete</span>
      </Button>
    </>
  );
}

export function NodesListPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: site } = useQuery({ queryKey: keys.site(siteId!), queryFn: () => queries.getSite(siteId!), enabled: !!siteId });
  const { data, isLoading, error } = useQuery({
    queryKey: keys.nodes(siteId!),
    queryFn: () => queries.listNodes(siteId!),
    enabled: !!siteId,
  });

  const [view, setView] = useState<ViewMode>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_STORAGE_KEY) : null;
    return stored === 'table' ? 'table' : 'cards';
  });
  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore storage failures */
    }
  };

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sites/${siteId}/nodes/${id}`),
    onSuccess: () => {
      toast.success('Node deleted');
      qc.invalidateQueries({ queryKey: keys.nodes(siteId!) });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const hasNodes = !!data && data.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Nodes"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<Server className="size-6" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasNodes && (
              <div
                role="group"
                aria-label="Node view"
                className="inline-flex rounded-md border border-border p-0.5"
              >
                <Button
                  variant={view === 'cards' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={view === 'cards'}
                  aria-label="Card view"
                  leftIcon={<LayoutGrid className="size-4" />}
                  onClick={() => changeView('cards')}
                >
                  <span className="hidden sm:inline">Cards</span>
                </Button>
                <Button
                  variant={view === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={view === 'table'}
                  aria-label="Table view"
                  leftIcon={<Rows3 className="size-4" />}
                  onClick={() => changeView('table')}
                >
                  <span className="hidden sm:inline">Table</span>
                </Button>
              </div>
            )}
            <ButtonLink
              as={Link}
              to={`/sites/${siteId}/nodes/import`}
              variant="outline"
              aria-label="Import from Proxmox"
              leftIcon={<Download className="size-4" />}
            >
              <span className="hidden sm:inline">Import from Proxmox</span>
            </ButtonLink>
            <ButtonLink
              as={Link}
              to={`/sites/${siteId}/nodes/new`}
              variant="primary"
              aria-label="New node"
              leftIcon={<Plus className="size-4" />}
            >
              <span className="hidden sm:inline">New node</span>
            </ButtonLink>
          </div>
        }
      />
      {error && <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>}
      {isLoading && <div className="flex justify-center p-12"><Spinner size="lg" /></div>}
      {data && data.length === 0 && (
        <Alert variant="info">
          <AlertDescription>No nodes yet. Add one with the button above.</AlertDescription>
        </Alert>
      )}

      {hasNodes && view === 'cards' && (
        <div className="grid gap-2">
          {data.map((n: Node) => (
            <Card
              key={n.id}
              as="article"
              padding="none"
              orientation="horizontal"
              className="flex w-full flex-row flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2 lg:order-1">
                <CardTitle as="h2" className="truncate text-sm font-semibold">
                  {n.name}
                </CardTitle>
                <NvidiaBadge n={n} />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1 lg:order-3 lg:ml-0">
                <RowActions n={n} siteId={siteId} onDelete={del.mutate} deleting={del.isPending} />
              </div>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 lg:order-2 lg:w-auto lg:flex-1">
                <Meta label="IPv4">
                  <span className="font-mono">{n.ipv4Address || '—'}</span>
                </Meta>
                <Meta label="API">
                  <span className="break-all font-mono" title={n.apiUrl || undefined}>
                    {n.apiUrl || '—'}
                  </span>
                </Meta>
                <Meta label="Creds">
                  <CredentialsBadge n={n} />
                </Meta>
              </div>
            </Card>
          ))}
        </div>
      )}

      {hasNodes && view === 'table' && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>IPv4</TableHead>
              <TableHead>API URL</TableHead>
              <TableHead>NVIDIA</TableHead>
              <TableHead>Credentials</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((n: Node) => (
              <TableRow key={n.id}>
                <TableCell className="font-medium">{n.name}</TableCell>
                <TableCell className="font-mono text-sm">{n.ipv4Address || '—'}</TableCell>
                <TableCell className="max-w-xs truncate">{n.apiUrl || '—'}</TableCell>
                <TableCell>
                  <NvidiaBadge n={n} />
                </TableCell>
                <TableCell>
                  <CredentialsBadge n={n} />
                </TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2">
                  <RowActions n={n} siteId={siteId} onDelete={del.mutate} deleting={del.isPending} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
