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
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { ButtonLink } from '@/components/ButtonLink';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { ExternalDomain } from '@/lib/types';

export function ExternalDomainsListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: keys.externalDomains(),
    queryFn: queries.listExternalDomains,
  });
  const qc = useQueryClient();
  const toast = useToast();
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/external-domains/${id}`),
    onSuccess: () => {
      toast.success('External domain deleted');
      qc.invalidateQueries({ queryKey: keys.externalDomains() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="External domains"
        subtitle="Public DNS zones with optional Cloudflare automation"
        icon={<Globe className="size-6" />}
        actions={
          <ButtonLink as={Link} to="/external-domains/new" variant="primary" leftIcon={<Plus className="size-4" />}>
            New domain
          </ButtonLink>
        }
      />
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
      {data && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Cloudflare</TableHead>
              <TableHead>oauth2-proxy</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((d: ExternalDomain) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{d.site?.name || '—'}</TableCell>
                <TableCell>
                  {d.hasCloudflareApiKey ? (
                    <Badge variant="success">Configured</Badge>
                  ) : (
                    <Badge variant="secondary">Not configured</Badge>
                  )}
                </TableCell>
                <TableCell>{d.authServer || '—'}</TableCell>
                <TableCell className="flex flex-wrap justify-end gap-2">
                  <ButtonLink as={Link} to={`/external-domains/${d.id}/edit`} variant="ghost" size="sm" leftIcon={<Pencil className="size-4" />}>
                    Edit
                  </ButtonLink>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-4" />}
                    onClick={() => {
                      if (confirm(`Delete external domain "${d.name}"?`)) del.mutate(d.id);
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
