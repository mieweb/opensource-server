import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@mieweb/ui';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { OAuthClient, OAuthClientCreated } from '@/lib/types';

/**
 * OAuth clients for machine-to-machine access (client_credentials grant).
 * Each acts as the user who created it, like an API key. The secret is shown
 * once, at creation.
 */
export function OAuthClientsSection() {
  const { data, isLoading, error } = useQuery({ queryKey: keys.oauthClients(), queryFn: queries.listOAuthClients });
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<OAuthClientCreated | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.oauthClients() });
    qc.invalidateQueries({ queryKey: ['oauth-grants'] });
  };

  const create = useMutation({
    mutationFn: () => api.post<OAuthClientCreated>('/api/v1/oauth-clients', { name }),
    onSuccess: (client) => {
      setCreated(client);
      setName('');
      setCreating(false);
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/oauth-clients/${id}`),
    onSuccess: () => {
      toast.success('OAuth client deleted');
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const copy = (value: string) => {
    navigator.clipboard.writeText(value).catch(() => undefined);
    toast.success('Copied to clipboard');
  };

  return (
    <section aria-labelledby="oauth-clients-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="oauth-clients-heading" className="text-lg font-semibold">OAuth clients</h2>
          <p className="text-sm text-zinc-500">
            Client ID and secret for machine-to-machine OAuth (client credentials). Each acts as you.
          </p>
        </div>
        {!creating && (
          <Button variant="outline" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New OAuth client
          </Button>
        )}
      </div>

      {created && (
        <Alert variant="success" role="status" aria-live="polite">
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <strong>{created.warning}</strong>
              {([['Client ID', created.clientId], ['Client secret', created.clientSecret]] as const).map(([label, value]) => (
                <div key={label} className="flex flex-wrap items-center gap-2">
                  <span className="w-28 text-sm">{label}</span>
                  <code className="rounded bg-zinc-100 px-2 py-1 font-mono text-sm break-all text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                    {value}
                  </code>
                  <Button size="sm" variant="outline" aria-label={`Copy ${label}`} onClick={() => copy(value)}>Copy</Button>
                </div>
              ))}
              <div>
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Dismiss</Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="flex flex-col gap-3 rounded-lg border border-(--color-border,#e5e7eb) p-4"
        >
          <Input
            label="Name"
            placeholder="What will use this client?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary" isLoading={create.isPending}>Create client</Button>
          </div>
        </form>
      )}

      {error && <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>}
      {isLoading && <div className="flex justify-center p-6"><Spinner size="md" /></div>}
      {data && data.length === 0 && <p className="text-sm text-zinc-500">No OAuth clients.</p>}
      {data && data.length > 0 && (
        <Table responsive aria-describedby="oauth-clients-heading">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Client ID</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c: OAuthClient) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell className="font-mono text-sm break-all">{c.clientId}</TableCell>
                <TableCell>{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : 'Never'}</TableCell>
                <TableCell>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    aria-label={`Delete OAuth client ${c.name}`}
                    onClick={() => {
                      if (confirm(`Delete ${c.name}? Its tokens stop working immediately.`)) remove.mutate(c.id);
                    }}
                    disabled={remove.isPending}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
