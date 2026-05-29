import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
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
import { Download, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { Node } from '@/lib/types';

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

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sites/${siteId}/nodes/${id}`),
    onSuccess: () => {
      toast.success('Node deleted');
      qc.invalidateQueries({ queryKey: keys.nodes(siteId!) });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Nodes"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<Server className="size-6" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={`/sites/${siteId}/nodes/import`}>
              <Button variant="outline" leftIcon={<Download className="size-4" />}>Import from Proxmox</Button>
            </Link>
            <Link to={`/sites/${siteId}/nodes/new`}>
              <Button variant="primary" leftIcon={<Plus className="size-4" />}>New node</Button>
            </Link>
          </div>
        }
      />
      {error && <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>}
      {isLoading && <div className="flex justify-center p-12"><Spinner size="lg" /></div>}
      {data && (
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
                <TableCell>{n.nvidiaAvailable ? <Badge variant="success">Available</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                <TableCell>{n.hasSecret ? <Badge variant="success">Set</Badge> : <Badge variant="warning">Missing</Badge>}</TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2">
                  <Link to={`/sites/${siteId}/nodes/${n.id}/edit`}>
                    <Button variant="ghost" size="sm" leftIcon={<Pencil className="size-4" />}>Edit</Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    onClick={() => { if (confirm(`Delete node "${n.name}"?`)) del.mutate(n.id); }}
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
