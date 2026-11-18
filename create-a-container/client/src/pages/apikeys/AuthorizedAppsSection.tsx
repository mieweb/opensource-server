import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@mieweb/ui';
import { Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { keys, queries } from '@/lib/queries';
import type { OAuthGrant } from '@/lib/types';

/**
 * "Authorized apps": OAuth clients (MCP clients such as VS Code or Claude)
 * the user signed in to. Revoking one stops its tokens at once. Admins can
 * switch to every user's grants.
 */
export function AuthorizedAppsSection() {
  const { data: session } = useSession();
  const isAdmin = !!session?.isAdmin;
  const [showAll, setShowAll] = useState(false);
  const all = isAdmin && showAll;

  const { data, isLoading, error } = useQuery({
    queryKey: keys.oauthGrants(all),
    queryFn: () => queries.listOAuthGrants(all),
  });
  const qc = useQueryClient();
  const toast = useToast();

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/oauth-grants/${id}`),
    onSuccess: () => {
      toast.success('Access revoked');
      qc.invalidateQueries({ queryKey: ['oauth-grants'] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <section aria-labelledby="authorized-apps-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="authorized-apps-heading" className="text-lg font-semibold">Authorized apps</h2>
          <p className="text-sm text-zinc-500">
            Applications you signed in to with OAuth, such as MCP clients. They act as you.
          </p>
        </div>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={showAll}
              onCheckedChange={(checked: boolean) => setShowAll(checked)}
              aria-label="Show authorized apps for all users"
            />
            All users
          </label>
        )}
      </div>

      {error && <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>}
      {isLoading && <div className="flex justify-center p-6"><Spinner size="md" /></div>}
      {data && data.length === 0 && <p className="text-sm text-zinc-500">No authorized apps.</p>}
      {data && data.length > 0 && (
        <Table responsive aria-describedby="authorized-apps-heading">
          <TableHeader>
            <TableRow>
              <TableHead>Application</TableHead>
              {all && <TableHead>User</TableHead>}
              <TableHead>Redirects to</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Authorized</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((g: OAuthGrant) => (
              <TableRow key={g.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{g.clientName}</span>
                    {g.registrationType === 'metadata_document' ? (
                      <Badge variant="secondary" title={g.clientId}>{new URL(g.clientId).host}</Badge>
                    ) : (
                      <Badge variant="secondary" title="The application named itself; the name is not verified.">
                        Unverified
                      </Badge>
                    )}
                  </div>
                </TableCell>
                {all && <TableCell>{g.user ?? '—'}</TableCell>}
                <TableCell className="font-mono text-sm">{g.redirectHosts.join(', ')}</TableCell>
                <TableCell>{g.lastUsedAt ? new Date(g.lastUsedAt).toLocaleString() : 'Never'}</TableCell>
                <TableCell>{new Date(g.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    aria-label={`Revoke access for ${g.clientName}`}
                    onClick={() => {
                      if (confirm(`Revoke access for ${g.clientName}? It will have to sign in again.`)) revoke.mutate(g.id);
                    }}
                    disabled={revoke.isPending}
                  >
                    Revoke
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
