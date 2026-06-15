import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import {
  Code2,
  Container as ContainerIcon,
  ExternalLink,
  LayoutGrid,
  Pencil,
  Plus,
  Rows3,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { keys, queries } from '@/lib/queries';
import type { Container, ContainerStatus } from '@/lib/types';

type ViewMode = 'cards' | 'table';
const VIEW_STORAGE_KEY = 'containers:view';

function statusVariant(
  s: ContainerStatus,
): 'default' | 'success' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'running':
      return 'success';
    case 'creating':
    case 'restarting':
      return 'warning';
    case 'failed':
    case 'out-of-sync':
      return 'danger';
    case 'offline':
    case 'missing':
      return 'secondary';
    default:
      return 'default';
  }
}

// Human-readable labels for the live status values.
const STATUS_LABELS: Record<ContainerStatus, string> = {
  running: 'Running',
  offline: 'Offline',
  creating: 'Creating',
  restarting: 'Restarting',
  failed: 'Failed',
  missing: 'Missing',
  'out-of-sync': 'Out of sync',
  unknown: 'Unknown',
};

// Statuses that are transitional and worth polling for.
const TRANSITIONAL_STATUSES: ReadonlySet<ContainerStatus> = new Set<ContainerStatus>([
  'creating',
  'restarting',
]);

/**
 * Live status badge. Per issue #350 each row queries the dedicated
 * /containers/:id/status endpoint. The status already returned by the list
 * endpoint seeds initialData so the badge paints instantly, then this query
 * keeps it fresh (polling while the container is in a transitional state).
 */
function ContainerStatusBadge({
  siteId,
  container,
}: {
  siteId: string | undefined;
  container: Container;
}) {
  const { data } = useQuery({
    queryKey: keys.containerStatus(siteId!, container.id),
    queryFn: () => queries.getContainerStatus(siteId!, container.id),
    enabled: !!siteId,
    initialData: { status: container.status },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TRANSITIONAL_STATUSES.has(status) ? 4000 : false;
    },
  });
  const status = data?.status ?? container.status;
  return <Badge variant={statusVariant(status)}>{STATUS_LABELS[status] ?? status}</Badge>;
}

const linkClass = 'text-(--color-primary,#1d4ed8) hover:underline';

/** Shorten a full image ref to just its name+tag, e.g. ghcr.io/mieweb/base:latest -> base:latest */
function templateTitle(template: string | null): string {
  if (!template) return '—';
  return template.split('/').pop() || template;
}

function NodeLink({ c }: { c: Container }) {
  if (!c.nodeApiUrl) return <>{c.nodeName || '—'}</>;
  return (
    <a
      href={`${c.nodeApiUrl}${c.containerId ? `/#v1:0:=lxc%2F${c.containerId}:4:::::::` : ''}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open node in Proxmox web UI"
      className={linkClass}
    >
      {c.nodeName || c.nodeApiUrl}
    </a>
  );
}

function HttpLinks({ c, limit }: { c: Container; limit?: number }) {
  if (c.httpEntries.length === 0) return <span className="text-muted-foreground">—</span>;
  const entries = limit ? c.httpEntries.slice(0, limit) : c.httpEntries;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {entries.map((h) =>
        h.externalUrl ? (
          <a
            key={`${c.id}-${h.port}`}
            href={h.externalUrl}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1 text-xs ${linkClass}`}
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            <span className="break-all">{h.externalUrl.replace(/^https?:\/\//, '')}</span>
          </a>
        ) : (
          <span key={`${c.id}-${h.port}`} className="text-xs">
            :{h.port}
          </span>
        ),
      )}
    </span>
  );
}

function SshLinks({ c, sessionUser }: { c: Container; sessionUser?: string }) {
  if (!c.sshHost || !c.sshPort) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs">
      <span className="whitespace-nowrap">
        {c.sshHost}:{c.sshPort}
      </span>
      {sessionUser && (
        <>
          <a
            href={`vscode://vscode-remote/ssh-remote+${sessionUser}@${c.sshHost}:${c.sshPort}/`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in VS Code"
            aria-label={`Open SSH in VS Code for container ${c.hostname}`}
            className={linkClass}
          >
            <Code2 className="size-4" aria-hidden="true" />
          </a>
          <a
            href={`ssh://${sessionUser}@${c.sshHost}:${c.sshPort}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open SSH in terminal"
            aria-label={`Open SSH terminal for container ${c.hostname}`}
            className={linkClass}
          >
            <Terminal className="size-4" aria-hidden="true" />
          </a>
        </>
      )}
    </span>
  );
}

function RowActions({
  c,
  siteId,
  onDelete,
  deleting,
}: {
  c: Container;
  siteId?: string;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  return (
    <>
      {c.creationJobId && (
        <Link to={`/jobs/${c.creationJobId}`}>
          <Button variant="ghost" size="sm">
            Logs
          </Button>
        </Link>
      )}
      <Link to={`/sites/${siteId}/containers/${c.id}/edit`}>
        <Button variant="ghost" size="sm" aria-label="Edit" leftIcon={<Pencil className="size-4" />}>
          <span className="hidden sm:inline">Edit</span>
        </Button>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Delete"
        leftIcon={<Trash2 className="size-4" />}
        onClick={() => {
          if (confirm(`Delete container "${c.hostname}"?`)) onDelete(c.id);
        }}
        disabled={deleting}
      >
        <span className="hidden sm:inline">Delete</span>
      </Button>
    </>
  );
}

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

export function ContainersListPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const sessionUser = session?.user;
  const location = useLocation();
  const dnsWarnings = (location.state as { dnsWarnings?: string[] } | null)?.dnsWarnings;

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

  const { data: site } = useQuery({
    queryKey: keys.site(siteId!),
    queryFn: () => queries.getSite(siteId!),
    enabled: !!siteId,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: keys.containers(siteId!),
    queryFn: () => queries.listContainers(siteId!),
    enabled: !!siteId,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sites/${siteId}/containers/${id}`),
    onSuccess: () => {
      toast.success('Container deleted');
      qc.invalidateQueries({ queryKey: keys.containers(siteId!) });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const hasContainers = !!data && data.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Containers"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<ContainerIcon className="size-6" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasContainers && (
              <div
                role="group"
                aria-label="Container view"
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
            <Link to={`/sites/${siteId}/nodes`}>
              <Button variant="ghost" aria-label="Nodes" leftIcon={<Server className="size-4" />}>
                <span className="hidden sm:inline">Nodes</span>
              </Button>
            </Link>
            <Link to={`/sites/${siteId}/containers/new`}>
              <Button variant="primary" aria-label="New container" leftIcon={<Plus className="size-4" />}>
                <span className="hidden sm:inline">New container</span>
              </Button>
            </Link>
          </div>
        }
      />

      {error && (
        <Alert variant="danger">
          <AlertDescription>{(error as ApiError).message}</AlertDescription>
        </Alert>
      )}
      {dnsWarnings && dnsWarnings.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>DNS warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {dnsWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {isLoading && (
        <div className="flex justify-center p-12">
          <Spinner size="lg" />
        </div>
      )}
      {data && data.length === 0 && (
        <Alert variant="info">
          <AlertTitle>No containers</AlertTitle>
          <AlertDescription>Create your first container with the button above.</AlertDescription>
        </Alert>
      )}

      {hasContainers && view === 'cards' && (
        <div className="grid gap-2">
          {data.map((c: Container) => (
            <Card
              key={c.id}
              as="article"
              padding="none"
              orientation="horizontal"
              className="flex w-full flex-row flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2 lg:order-1">
                <CardTitle as="h2" className="truncate text-sm font-semibold">
                  {c.hostname}
                </CardTitle>
                <ContainerStatusBadge siteId={siteId} container={c} />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1 lg:order-3 lg:ml-0">
                <RowActions c={c} siteId={siteId} onDelete={del.mutate} deleting={del.isPending} />
              </div>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 lg:order-2 lg:w-auto lg:flex-1">
                <Meta label="Node">
                  <NodeLink c={c} />
                </Meta>
                <Meta label="Template">
                  <span className="font-mono" title={c.template || undefined}>
                    {templateTitle(c.template)}
                  </span>
                </Meta>
                <Meta label="HTTP">
                  <HttpLinks c={c} />
                </Meta>
                <Meta label="SSH">
                  <SshLinks c={c} sessionUser={sessionUser} />
                </Meta>
              </div>
            </Card>
          ))}
        </div>
      )}

      {hasContainers && view === 'table' && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>Hostname</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Node</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>HTTP</TableHead>
              <TableHead>SSH</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c: Container) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.hostname}</TableCell>
                <TableCell>
                  <ContainerStatusBadge siteId={siteId} container={c} />
                </TableCell>
                <TableCell>
                  <NodeLink c={c} />
                </TableCell>
                <TableCell className="font-mono text-xs" title={c.template || undefined}>
                  {templateTitle(c.template)}
                </TableCell>
                <TableCell>
                  <HttpLinks c={c} limit={2} />
                </TableCell>
                <TableCell>
                  <SshLinks c={c} sessionUser={sessionUser} />
                </TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2">
                  <RowActions c={c} siteId={siteId} onDelete={del.mutate} deleting={del.isPending} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
