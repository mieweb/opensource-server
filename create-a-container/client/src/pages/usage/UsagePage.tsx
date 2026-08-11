import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, PageHeader, Spinner } from '@mieweb/ui';
import { Activity } from 'lucide-react';
import { AttributionWarnings } from '@/components/usage/AttributionWarnings';
import { UsageDataGrid } from '@/components/usage/UsageDataGrid';
import type { ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';

/**
 * Live per-owner resource usage for the current site (allocated vs used),
 * computed on demand from the hypervisor. Admins see every owner plus
 * attribution warnings; other users see their own and shared containers.
 */
export function UsagePage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { data: site } = useQuery({
    queryKey: keys.site(siteId!),
    queryFn: () => queries.getSite(siteId!),
    enabled: !!siteId,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: keys.usage(siteId!),
    queryFn: () => queries.getUsage(siteId!),
    enabled: !!siteId,
    // The report is a live hypervisor query; keep it reasonably fresh while
    // the page is open without hammering the Proxmox API.
    refetchInterval: 60000,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usage"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<Activity className="size-6" />}
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
        <AttributionWarnings
          findings={data.findings ?? []}
          unknownNodeRows={data.unknownNodeRows}
        />
      )}
      {data && data.owners.length === 0 && (
        <Alert variant="info">
          <AlertDescription>No running containers to report on.</AlertDescription>
        </Alert>
      )}
      {data && data.owners.length > 0 && <UsageDataGrid owners={data.owners} />}
    </div>
  );
}
