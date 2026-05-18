import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
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
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { ApiKey, ApiKeyCreated } from '@/lib/types';

export function ApiKeysListPage() {
  const { data, isLoading, error } = useQuery({ queryKey: keys.apikeys(), queryFn: queries.listApiKeys });
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.post<ApiKeyCreated>('/api/v1/apikeys', { description }),
    onSuccess: (key) => {
      setCreated(key);
      setDescription('');
      setCreating(false);
      qc.invalidateQueries({ queryKey: keys.apikeys() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/apikeys/${id}`),
    onSuccess: () => {
      toast.success('API key revoked');
      qc.invalidateQueries({ queryKey: keys.apikeys() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="API keys"
        subtitle="Personal access tokens for the JSON API"
        icon={<KeyRound className="size-6" />}
        actions={
          !creating && (
            <Button variant="primary" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New API key
            </Button>
          )
        }
      />

      {created && (
        <Alert variant="success">
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <strong>{created.warning}</strong>
              <div className="flex items-center gap-2">
                <code className="rounded bg-(--color-surface-2,#f5f5f5) px-2 py-1 font-mono text-sm break-all">
                  {created.key}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(created.key).catch(() => undefined);
                    toast.success('Copied to clipboard');
                  }}
                >
                  Copy
                </Button>
              </div>
              <div>
                <Link to="#" onClick={(e) => { e.preventDefault(); setCreated(null); }}>
                  Dismiss
                </Link>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          className="flex flex-col gap-3 rounded-lg border border-(--color-border,#e5e7eb) p-4"
        >
          <Input
            label="Description"
            placeholder="What is this key for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary" isLoading={createMutation.isPending}>Generate key</Button>
          </div>
        </form>
      )}

      {error && <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>}
      {isLoading && <div className="flex justify-center p-12"><Spinner size="lg" /></div>}
      {data && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>Prefix</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((k: ApiKey) => (
              <TableRow key={k.id}>
                <TableCell className="font-mono">{k.keyPrefix}…</TableCell>
                <TableCell>{k.description || '—'}</TableCell>
                <TableCell>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</TableCell>
                <TableCell>{new Date(k.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    onClick={() => { if (confirm('Revoke this API key?')) del.mutate(k.id); }}
                    disabled={del.isPending}
                  >
                    Revoke
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
