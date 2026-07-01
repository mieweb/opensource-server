import { useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardTitle,
  Modal,
  ModalBody,
  ModalClose,
  ModalHeader,
  ModalTitle,
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
  Share2,
  Terminal,
  Trash2,
  User,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { keys, queries } from '@/lib/queries';
import { CollaboratorsManager } from './CollaboratorsManager';
import { ContainerFilters, type FilterOption } from './ContainerFilters';
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

// Human-readable labels for the live status values.
const STATUS_LABELS: Record<ContainerStatus, string> = {
  running: 'Running',
  offline: 'Offline',
  creating: 'Creating',
  failed: 'Failed',
  missing: 'Missing',
  unknown: 'Unknown',
};

/** Status badge. The status is the live value embedded in the list response. */
function StatusBadge({ status }: { status: ContainerStatus }) {
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
  canShare,
  onShare,
}: {
  c: Container;
  siteId?: string;
  onDelete: (id: number) => void;
  deleting: boolean;
  canShare: boolean;
  onShare: (c: Container) => void;
}) {
  return (
    <>
      {c.creationJobId && (
        <Link to={`/jobs/${c.creationJobId}`}>
          <Button
            variant="ghost"
            size="sm"
            className="transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Logs
          </Button>
        </Link>
      )}
      {canShare && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Share ${c.hostname}`}
          leftIcon={<Share2 className="size-4" />}
          onClick={() => onShare(c)}
          className="transition-colors hover:bg-violet-100 hover:text-violet-700 dark:hover:bg-violet-900/40 dark:hover:text-violet-200"
        >
          <span className="hidden sm:inline">Share</span>
        </Button>
      )}
      <Link to={`/sites/${siteId}/containers/${c.id}/edit`}>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Edit"
          leftIcon={<Pencil className="size-4" />}
          className="transition-colors hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/40 dark:hover:text-sky-200"
        >
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
        className="transition-colors hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-200"
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
  const isAdmin = !!session?.isAdmin;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const nodeId = searchParams.get('nodeId') || undefined;
  // The URL is the single source of truth for the filter bar, so views are
  // bookmarkable and shareable. `user` is a comma-separated owner list (or the
  // wildcard `*`) that drives the server query; an empty list defaults to the
  // caller's own containers. Status/template/hostname refine the loaded rows
  // client-side.
  const parseList = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
  const selectedUsers = parseList(searchParams.get('user'));
  const selectedStatuses = parseList(searchParams.get('status'));
  const selectedTemplates = parseList(searchParams.get('template'));
  const hostnameQuery = searchParams.get('q') ?? '';
  // A row may belong to another owner once the user filter is anything other
  // than "just me", so the owner column only earns its place then.
  const showOwner = selectedUsers.some((u) => u === '*' || u !== sessionUser);
  const dnsWarnings = (location.state as { dnsWarnings?: string[] } | null)?.dnsWarnings;

  const setListParam = (key: string, values: string[]) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (values.length > 0) next.set(key, values.join(','));
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const setTextParam = (key: string, value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  // "Everyone"/"All shared" (`*`) is exclusive: turning it on clears specific
  // owners, and picking a specific owner drops it.
  const onUsersChange = (next: string[]) => {
    const gainedWildcard = next.includes('*') && !selectedUsers.includes('*');
    const normalized = gainedWildcard ? ['*'] : next.filter((v) => v !== '*');
    setListParam('user', normalized);
  };
  const clearAllFilters = () =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        ['user', 'status', 'template', 'q'].forEach((k) => next.delete(k));
        return next;
      },
      { replace: true },
    );

  const [view, setView] = useState<ViewMode>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_STORAGE_KEY) : null;
    return stored === 'table' ? 'table' : 'cards';
  });
  // Container whose sharing dialog is open. Tracked by id so the dialog reflects
  // live collaborator changes after the list query refetches.
  const [shareTargetId, setShareTargetId] = useState<number | null>(null);
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
  // Empty selection defaults to the caller's own containers server-side.
  const userParam = selectedUsers.length > 0 ? selectedUsers.join(',') : undefined;
  const { data, isLoading, error } = useQuery({
    queryKey: keys.containers(siteId!, { user: userParam, nodeId }),
    queryFn: () => queries.listContainers(siteId!, { user: userParam, nodeId }),
    enabled: !!siteId,
  });

  // Options for the "User" filter. Admins may filter by any user; non-admins may
  // only narrow to owners who have shared a container with them, so their option
  // list is derived from everything they can currently see (own + shared).
  const { data: allUsers } = useQuery({
    queryKey: keys.users(),
    queryFn: queries.listUsers,
    enabled: !!siteId && isAdmin,
  });
  const { data: visibleContainers } = useQuery({
    queryKey: keys.containers(siteId!, { user: '*' }),
    queryFn: () => queries.listContainers(siteId!, { user: '*' }),
    enabled: !!siteId && !isAdmin,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sites/${siteId}/containers/${id}`),
    onSuccess: () => {
      toast.success('Container deleted');
      qc.invalidateQueries({ queryKey: keys.containers(siteId!) });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  // Client-side refinement of the loaded rows by status/template/hostname.
  const visible = useMemo(() => {
    const q = hostnameQuery.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (selectedStatuses.length === 0 || selectedStatuses.includes(c.status)) &&
        (selectedTemplates.length === 0 ||
          (c.template != null && selectedTemplates.includes(c.template))) &&
        (q === '' || c.hostname.toLowerCase().includes(q)),
    );
  }, [data, selectedStatuses, selectedTemplates, hostnameQuery]);

  const userOptions = useMemo<FilterOption[]>(() => {
    const base: FilterOption[] = [
      { value: '*', label: isAdmin ? 'Everyone' : 'All shared' },
    ];
    const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label);
    if (isAdmin) {
      const opts = (allUsers ?? []).map((u) => ({
        value: u.uid,
        label: u.uid === sessionUser ? `${u.cn} (me)` : u.cn,
      }));
      return [...base, ...opts.sort(byLabel)];
    }
    const owners = new Set<string>();
    if (sessionUser) owners.add(sessionUser);
    (visibleContainers ?? []).forEach((c) => owners.add(c.owner));
    const opts = [...owners].map((o) => ({
      value: o,
      label: o === sessionUser ? `${o} (me)` : o,
    }));
    return [...base, ...opts.sort(byLabel)];
  }, [isAdmin, allUsers, visibleContainers, sessionUser]);

  const statusOptions = useMemo<FilterOption[]>(
    () =>
      (Object.keys(STATUS_LABELS) as ContainerStatus[]).map((s) => ({
        value: s,
        label: STATUS_LABELS[s],
      })),
    [],
  );

  const templateOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>();
    (data ?? []).forEach((c) => {
      if (c.template) seen.set(c.template, templateTitle(c.template));
    });
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const hasContainers = visible.length > 0;
  const serverHasContainers = !!data && data.length > 0;

  // Sharing is owner/admin only. Derive the open dialog's container from the
  // live list so its collaborator chips update after add/remove.
  const canShareContainer = (c: Container) => isAdmin || c.owner === sessionUser;
  const shareTarget = data?.find((c) => c.id === shareTargetId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Containers"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<ContainerIcon className="size-6" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {serverHasContainers && (
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

      <ContainerFilters
        userOptions={userOptions}
        selectedUsers={selectedUsers}
        onUsersChange={onUsersChange}
        statusOptions={statusOptions}
        selectedStatuses={selectedStatuses}
        onStatusesChange={(v) => setListParam('status', v)}
        templateOptions={templateOptions}
        selectedTemplates={selectedTemplates}
        onTemplatesChange={(v) => setListParam('template', v)}
        hostname={hostnameQuery}
        onHostnameChange={(v) => setTextParam('q', v)}
        onClearAll={clearAllFilters}
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
          <AlertDescription>
            {showOwner
              ? 'No containers match the selected users.'
              : 'Create your first container with the button above.'}
          </AlertDescription>
        </Alert>
      )}
      {serverHasContainers && !hasContainers && (
        <Alert variant="info">
          <AlertTitle>No matches</AlertTitle>
          <AlertDescription>No containers match the current filters.</AlertDescription>
        </Alert>
      )}

      {hasContainers && view === 'cards' && (
        <div className="grid gap-2">
          {visible.map((c: Container) => (
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
                <StatusBadge status={c.status} />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1 lg:order-3 lg:ml-0">
                <RowActions
                  c={c}
                  siteId={siteId}
                  onDelete={del.mutate}
                  deleting={del.isPending}
                  canShare={canShareContainer(c)}
                  onShare={(target) => setShareTargetId(target.id)}
                />
              </div>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 lg:order-2 lg:w-auto lg:flex-1">
                <Meta label="Node">
                  <NodeLink c={c} />
                </Meta>
                {showOwner && (
                  <Meta label="User">
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3.5" aria-hidden="true" />
                      {c.owner}
                    </span>
                  </Meta>
                )}
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
              {showOwner && <TableHead>User</TableHead>}
              <TableHead>Template</TableHead>
              <TableHead>HTTP</TableHead>
              <TableHead>SSH</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((c: Container) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.hostname}</TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell>
                  <NodeLink c={c} />
                </TableCell>
                {showOwner && (
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3.5" aria-hidden="true" />
                      {c.owner}
                    </span>
                  </TableCell>
                )}
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
                  <RowActions
                    c={c}
                    siteId={siteId}
                    onDelete={del.mutate}
                    deleting={del.isPending}
                    canShare={canShareContainer(c)}
                    onShare={(target) => setShareTargetId(target.id)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Modal
        open={shareTarget !== null}
        onOpenChange={(open) => !open && setShareTargetId(null)}
        size="md"
      >
        <ModalHeader>
          <ModalTitle>
            {shareTarget ? `Share ${shareTarget.hostname}` : 'Share container'}
          </ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Share this container with other users for collaboration. Shared users can find it
            by filtering the containers list by your username.
          </p>
          {shareTarget && siteId && (
            <CollaboratorsManager
              siteId={siteId}
              containerId={shareTarget.id}
              collaborators={shareTarget.collaborators}
            />
          )}
        </ModalBody>
      </Modal>
    </div>
  );
}
