import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, AlertDescription, Badge, Button, PageHeader, Spinner, Switch,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast,
} from '@mieweb/ui';
import { Mail, MailX, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { MailAccount, MailAccountSecret } from '@/lib/types';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { MailCredentialsAlert } from './MailCredentialsAlert';
import { NewMailAccountForm } from './NewMailAccountForm';
import { SuppressionsModal } from './SuppressionsModal';

export function MailAccountsListPage() {
  useDocumentTitle('Email accounts');
  const { data, isLoading, error } = useQuery({
    queryKey: keys.mailAccounts(),
    queryFn: queries.listMailAccounts,
  });
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<MailAccountSecret | null>(null);
  const [suppressionsFor, setSuppressionsFor] = useState<MailAccount | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: keys.mailAccounts() });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<MailAccount>(`/api/v1/mail-accounts/${id}`, body),
    onSuccess: invalidate,
    onError: (err: ApiError) => toast.error(err.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) =>
      api.post<MailAccountSecret>(`/api/v1/mail-accounts/${id}/rotate-password`),
    onSuccess: (secret) => {
      setCreated(secret);
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/mail-accounts/${id}`),
    onSuccess: () => {
      toast.success('Email account deleted');
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email accounts"
        subtitle="SMTP submission and IMAP mailboxes on your external domains"
        icon={<Mail className="size-6" />}
        actions={
          !creating && (
            <Button
              variant="primary"
              className="cursor-pointer"
              leftIcon={<Plus className="size-4" />}
              onClick={() => setCreating(true)}
            >
              New email account
            </Button>
          )
        }
      />

      {created && <MailCredentialsAlert created={created} onDismiss={() => setCreated(null)} />}

      {creating && (
        <NewMailAccountForm
          onCreated={(secret) => {
            setCreated(secret);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {error && (
        <Alert variant="danger">
          <AlertDescription>{(error as ApiError).message}</AlertDescription>
        </Alert>
      )}
      {isLoading && (
        <div className="flex justify-center p-12">
          <Spinner size="lg" />
        </div>
      )}

      {data && data.length === 0 && !creating && (
        <Alert variant="info">
          <AlertDescription>
            No email accounts yet. Create one to send via SMTP (ports 587/465) and read replies
            via IMAP (ports 993/143) on an enabled domain.
          </AlertDescription>
        </Alert>
      )}

      {data && data.length > 0 && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Quota</TableHead>
              <TableHead>Unsubscribe headers</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((a: MailAccount) => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-sm">{a.address}</TableCell>
                <TableCell>{a.description || '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {a.enabled ? (
                      <Badge variant="success">Enabled</Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                    {a.domain && !a.domain.canSend && (
                      <Badge variant="warning" title="The domain is disabled or its DNS no longer verifies — SMTP login is refused; IMAP stays readable.">
                        Domain can't send
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{a.quotaMb} MB</TableCell>
                <TableCell>
                  <Switch
                    checked={a.unsubscribeHeaders}
                    onCheckedChange={(checked: boolean) =>
                      patch.mutate({ id: a.id, body: { unsubscribeHeaders: checked } })
                    }
                    aria-label={`Toggle RFC 8058 unsubscribe headers for ${a.address}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="cursor-pointer"
                      leftIcon={<RefreshCw className="size-4" />}
                      onClick={() => {
                        if (confirm(`Rotate the password for ${a.address}? The current password stops working immediately.`)) {
                          rotate.mutate(a.id);
                        }
                      }}
                      disabled={rotate.isPending}
                    >
                      Rotate password
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="cursor-pointer"
                      leftIcon={<MailX className="size-4" />}
                      onClick={() => setSuppressionsFor(a)}
                    >
                      Suppressions
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="cursor-pointer"
                      onClick={() => patch.mutate({ id: a.id, body: { enabled: !a.enabled } })}
                      disabled={patch.isPending}
                    >
                      {a.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="cursor-pointer"
                      leftIcon={<Trash2 className="size-4" />}
                      onClick={() => {
                        if (confirm(`Delete ${a.address}? Its mailbox is removed after a retention window.`)) {
                          del.mutate(a.id);
                        }
                      }}
                      disabled={del.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {suppressionsFor && (
        <SuppressionsModal account={suppressionsFor} onClose={() => setSuppressionsFor(null)} />
      )}
    </div>
  );
}
