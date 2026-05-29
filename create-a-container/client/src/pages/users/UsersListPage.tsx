import { Link } from 'react-router';
import { useState } from 'react';
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
import { Mail, Megaphone, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { User } from '@/lib/types';
import { EmailAllModal } from './EmailAllModal';

export function UsersListPage() {
  const { data, isLoading, error } = useQuery({ queryKey: keys.users(), queryFn: queries.listUsers });
  const qc = useQueryClient();
  const toast = useToast();
  const [emailAllOpen, setEmailAllOpen] = useState(false);
  const del = useMutation({
    mutationFn: (uid: number) => api.delete(`/api/v1/users/${uid}`),
    onSuccess: () => {
      toast.success('User deleted');
      qc.invalidateQueries({ queryKey: keys.users() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        icon={<Users className="size-6" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              leftIcon={<Megaphone className="size-4" />}
              onClick={() => setEmailAllOpen(true)}
              disabled={!data || data.length === 0}
            >
              Email all
            </Button>
            <Link to="/users/invite">
              <Button variant="outline" leftIcon={<Mail className="size-4" />}>Invite</Button>
            </Link>
            <Link to="/users/new">
              <Button variant="primary" leftIcon={<Plus className="size-4" />}>New user</Button>
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
              <TableHead>UID</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((u: User) => (
              <TableRow key={u.uidNumber}>
                <TableCell className="font-mono">{u.uidNumber}</TableCell>
                <TableCell className="font-medium">{u.uid}</TableCell>
                <TableCell>{u.cn}</TableCell>
                <TableCell>{u.mail}</TableCell>
                <TableCell>
                  <Badge variant={u.status === 'active' ? 'success' : u.status === 'pending' ? 'warning' : 'secondary'}>
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell>{u.isAdmin ? <Badge variant="warning">Admin</Badge> : '—'}</TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2">
                  <Link to={`/users/${u.uidNumber}/edit`}>
                    <Button variant="ghost" size="sm" leftIcon={<Pencil className="size-4" />}>Edit</Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    onClick={() => { if (confirm(`Delete user "${u.uid}"?`)) del.mutate(u.uidNumber); }}
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
      <EmailAllModal
        open={emailAllOpen}
        onOpenChange={setEmailAllOpen}
        recipientCount={data?.filter((u: User) => u.mail?.trim()).length ?? 0}
      />
    </div>
  );
}
