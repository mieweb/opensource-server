import { Link, useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
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
import { Code2, Container as ContainerIcon, ExternalLink, Pencil, Plus, Terminal, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { keys, queries } from '@/lib/queries';
import type { Container } from '@/lib/types';

function statusVariant(s: string): 'default' | 'success' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'running':
      return 'success';
    case 'pending':
    case 'restarting':
      return 'warning';
    case 'failed':
    case 'error':
      return 'danger';
    case 'stopped':
      return 'secondary';
    default:
      return 'default';
  }
}

export function ContainersListPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const sessionUser = session?.user;
  const location = useLocation();
  const dnsWarnings = (location.state as { dnsWarnings?: string[] } | null)?.dnsWarnings;

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Containers"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<ContainerIcon className="size-6" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={`/sites/${siteId}/nodes`}>
              <Button variant="ghost">Nodes</Button>
            </Link>
            <Link to={`/sites/${siteId}/containers/new`}>
              <Button variant="primary" leftIcon={<Plus className="size-4" />}>
                New container
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

      {data && data.length > 0 && (
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
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </TableCell>
                <TableCell>
                  {c.nodeApiUrl ? (
                    <a
                      href={`${c.nodeApiUrl}${c.containerId ? `/#v1:0:=lxc%2F${c.containerId}:4:::::::` : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open node in Proxmox web UI"
                      className="text-(--color-primary,#1d4ed8) hover:underline"
                    >
                      {c.nodeName || c.nodeApiUrl}
                    </a>
                  ) : (
                    c.nodeName || '—'
                  )}
                </TableCell>
                <TableCell className="max-w-[18rem] truncate font-mono text-xs">
                  {c.template || '—'}
                </TableCell>
                <TableCell>
                  {c.httpEntries.length === 0 ? (
                    '—'
                  ) : (
                    <div className="flex flex-col gap-1">
                      {c.httpEntries.slice(0, 2).map((h) =>
                        h.externalUrl ? (
                          <a
                            key={`${c.id}-${h.port}`}
                            href={h.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-(--color-primary,#1d4ed8) hover:underline"
                          >
                            <ExternalLink className="size-3" />
                            {h.externalUrl.replace(/^https?:\/\//, '')}
                          </a>
                        ) : (
                          <span key={`${c.id}-${h.port}`} className="text-xs">
                            :{h.port}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {c.sshHost && c.sshPort ? (
                    <div className="flex items-center gap-2">
                      <span>{c.sshHost}:{c.sshPort}</span>
                      {sessionUser && (
                        <>
                          <a
                            href={`vscode://vscode-remote/ssh-remote+${sessionUser}@${c.sshHost}:${c.sshPort}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in VS Code"
                            aria-label={`Open SSH in VS Code for container ${c.hostname}`}
                            className="text-(--color-primary,#1d4ed8) hover:underline"
                          >
                            <Code2 className="size-4" aria-hidden="true" />
                          </a>
                          <a
                            href={`ssh://${sessionUser}@${c.sshHost}:${c.sshPort}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open SSH in terminal"
                            aria-label={`Open SSH terminal for container ${c.hostname}`}
                            className="text-(--color-primary,#1d4ed8) hover:underline"
                          >
                            <Terminal className="size-4" aria-hidden="true" />
                          </a>
                        </>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2">
                  {c.creationJobId && (
                    <Link to={`/jobs/${c.creationJobId}`}>
                      <Button variant="ghost" size="sm">
                        Logs
                      </Button>
                    </Link>
                  )}
                  <Link to={`/sites/${siteId}/containers/${c.id}/edit`}>
                    <Button variant="ghost" size="sm" leftIcon={<Pencil className="size-4" />}>
                      Edit
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    onClick={() => {
                      if (confirm(`Delete container "${c.hostname}"?`)) del.mutate(c.id);
                    }}
                    disabled={del.isPending}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
