import { Link } from 'react-router';
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
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { useSession } from '@/lib/auth';
import type { Site } from '@/lib/types';

export function SitesListPage() {
  const { data: session } = useSession();
  const { data, isLoading, error } = useQuery({
    queryKey: keys.sites(),
    queryFn: queries.listSites,
  });
  const qc = useQueryClient();
  const toast = useToast();
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sites/${id}`),
    onSuccess: () => {
      toast.success('Site deleted');
      qc.invalidateQueries({ queryKey: keys.sites() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sites"
        subtitle="Logical groupings of nodes and containers"
        icon={<Building2 className="size-6" />}
        actions={
          session?.isAdmin && (
            <Link to="/sites/new">
              <Button variant="primary" leftIcon={<Plus className="size-4" />}>
                New site
              </Button>
            </Link>
          )
        }
      />

      {error && (
        <Alert variant="danger">
          <AlertTitle>Failed to load sites</AlertTitle>
          <AlertDescription>{(error as ApiError).message}</AlertDescription>
        </Alert>
      )}
      {isLoading && (
        <div className="flex justify-center p-12">
          <Spinner size="lg" />
        </div>
      )}
      {data && data.length === 0 && (
        <Alert variant="info">
          <AlertTitle>No sites yet</AlertTitle>
          <AlertDescription>Create a site to begin managing nodes and containers.</AlertDescription>
        </Alert>
      )}
      {data && data.length > 0 && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Internal domain</TableHead>
              <TableHead>Gateway</TableHead>
              <TableHead>External IP</TableHead>
              <TableHead>Nodes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((s: Site) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">
                  <Link
                    to={`/sites/${s.id}/containers`}
                    className="hover:text-(--color-primary,#1d4ed8) hover:underline"
                  >
                    {s.name}
                  </Link>
                </TableCell>
                <TableCell>{s.internalDomain}</TableCell>
                <TableCell>{s.gateway || '—'}</TableCell>
                <TableCell>{s.externalIp || '—'}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{s.nodeCount ?? 0}</Badge>
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  {session?.isAdmin && (
                    <>
                      <Link to={`/sites/${s.id}/edit`}>
                        <Button variant="ghost" size="sm" leftIcon={<Pencil className="size-4" />}>
                          Edit
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="size-4" />}
                        onClick={() => {
                          if (confirm(`Delete site "${s.name}"?`)) del.mutate(s.id);
                        }}
                        disabled={del.isPending}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
