import { Link } from 'react-router';
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
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { Group } from '@/lib/types';

export function GroupsListPage() {
  const { data, isLoading, error } = useQuery({ queryKey: keys.groups(), queryFn: queries.listGroups });
  const qc = useQueryClient();
  const toast = useToast();
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/groups/${id}`),
    onSuccess: () => {
      toast.success('Group deleted');
      qc.invalidateQueries({ queryKey: keys.groups() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Groups"
        icon={<UsersRound className="size-6" />}
        actions={
          <Link to="/groups/new">
            <Button variant="primary" leftIcon={<Plus className="size-4" />}>
              New group
            </Button>
          </Link>
        }
      />
      {error && <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>}
      {isLoading && <div className="flex justify-center p-12"><Spinner size="lg" /></div>}
      {data && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>GID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Users</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((g: Group) => (
              <TableRow key={g.gidNumber}>
                <TableCell className="font-mono">{g.gidNumber}</TableCell>
                <TableCell className="font-medium">{g.cn}</TableCell>
                <TableCell>{g.isAdmin ? <Badge variant="warning">Admin</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                <TableCell>{g.userCount ?? 0}</TableCell>
                <TableCell className="flex justify-end gap-2">
                  <Link to={`/groups/${g.gidNumber}/edit`}>
                    <Button variant="ghost" size="sm" leftIcon={<Pencil className="size-4" />}>Edit</Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    onClick={() => {
                      if (confirm(`Delete group "${g.cn}"?`)) del.mutate(g.gidNumber);
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
