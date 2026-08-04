import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, PageHeader, Spinner, useToast } from '@mieweb/ui';
import { Download, Plus, Server } from 'lucide-react';
import { ButtonLink } from '@/components/ButtonLink';
import { NodesDataGrid } from '@/components/nodes/NodesDataGrid';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';

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

  const hasNodes = !!data && data.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Nodes"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<Server className="size-6" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink
              as={Link}
              to={`/sites/${siteId}/nodes/import`}
              variant="outline"
              aria-label="Import from Proxmox"
              leftIcon={<Download className="size-4" />}
            >
              <span className="hidden sm:inline">Import from Proxmox</span>
            </ButtonLink>
            <ButtonLink
              as={Link}
              to={`/sites/${siteId}/nodes/new`}
              variant="primary"
              aria-label="New node"
              leftIcon={<Plus className="size-4" />}
            >
              <span className="hidden sm:inline">New node</span>
            </ButtonLink>
          </div>
        }
      />
      {error && <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>}
      {isLoading && <div className="flex justify-center p-12"><Spinner size="lg" /></div>}
      {data && data.length === 0 && (
        <Alert variant="info">
          <AlertDescription>No nodes yet. Add one with the button above.</AlertDescription>
        </Alert>
      )}

      {hasNodes && (
        <NodesDataGrid nodes={data} siteId={siteId} onDelete={del.mutate} deleting={del.isPending} />
      )}
    </div>
  );
}
