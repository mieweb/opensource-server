import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@mieweb/ui';
import { ClipboardList } from 'lucide-react';
import { keys, queries } from '@/lib/queries';
import { FormPageHeader } from '@/components/FormPageHeader';

const RESOURCE_LABELS: Record<string, string> = {
  memory: 'RAM',
  swap: 'Swap',
  cpus: 'CPU',
  rootfs: 'Storage',
};

const RESOURCE_DEFAULTS: Record<string, number> = {
  memory: 4096,
  swap: 0,
  cpus: 4,
  rootfs: 50,
};

function formatValue(type: string, value: number) {
  if (type === 'memory' || type === 'swap') {
    return value >= 1024 ? `${(value / 1024).toFixed(1)}GB` : `${value}MB`;
  }
  if (type === 'rootfs') return `${value}GB`;
  return `${value}`;
}

function statusBadgeVariant(status: string) {
  if (status === 'approved') return 'success' as const;
  if (status === 'denied') return 'danger' as const;
  return 'warning' as const;
}

function statusLabel(status: string) {
  if (status === 'approved') return 'Approved';
  if (status === 'denied') return 'Denied';
  return 'Pending';
}

export function MyRequestsPage() {
  const { data: pendingRequests, isLoading: pendingLoading } = useQuery({
    queryKey: keys.resourceRequests('pending'),
    queryFn: () => queries.listResourceRequests('pending'),
  });

  const { data: closedRequests, isLoading: closedLoading } = useQuery({
    queryKey: keys.resourceRequests('closed'),
    queryFn: () => queries.listResourceRequests('closed'),
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <FormPageHeader
        icon={<ClipboardList className="size-6" />}
        title="My Resource Requests"
        subtitle="Track the status of your submitted resource requests."
      />

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending
            {pendingRequests && pendingRequests.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="closed">History</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {pendingLoading ? (
            <div className="flex justify-center p-12">
              <Spinner size="lg" />
            </div>
          ) : !pendingRequests || pendingRequests.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No pending requests.
              </CardContent>
            </Card>
          ) : (
            <RequestTable requests={pendingRequests} showReview={false} />
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          {closedLoading ? (
            <div className="flex justify-center p-12">
              <Spinner size="lg" />
            </div>
          ) : !closedRequests || closedRequests.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No closed requests yet.
              </CardContent>
            </Card>
          ) : (
            <RequestTable requests={closedRequests} showReview={true} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface Request {
  id: number;
  hostname: string;
  resourceType: string;
  value: number;
  status: string;
  comment: string | null;
  adminComment: string | null;
  reviewedBy: string | null;
  createdAt: string;
}

function RequestTable({
  requests,
  showReview,
}: {
  requests: Request[];
  showReview: boolean;
}) {
  return (
    <Card padding="none">
      <CardHeader className="border-b border-border bg-muted/30 px-6 py-4">
        <CardTitle className="text-base">
          {showReview ? 'Request History' : 'Pending Requests'}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            role="table"
            aria-label={showReview ? 'Closed resource requests' : 'Pending resource requests'}
          >
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="w-40 px-5 py-3.5 text-left font-medium">Container</th>
                <th className="w-32 px-5 py-3.5 text-left font-medium">Resource</th>
                <th className="w-36 px-5 py-3.5 text-left font-medium">Amount</th>
                <th className="w-48 px-5 py-3.5 text-left font-medium">Your Comment</th>
                <th className="w-32 px-5 py-3.5 text-left font-medium">Requested</th>
                <th className="w-28 px-5 py-3.5 text-left font-medium">Status</th>
                {showReview && (
                  <th className="min-w-[180px] px-5 py-3.5 text-left font-medium">
                    Admin Response
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => {
                const prevValue = RESOURCE_DEFAULTS[req.resourceType] ?? 0;
                return (
                  <tr key={req.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-4 font-mono text-xs">{req.hostname}</td>
                    <td className="px-5 py-4">
                      <Badge variant="outline">
                        {RESOURCE_LABELS[req.resourceType] || req.resourceType}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs">
                      <span className="text-muted-foreground">
                        {formatValue(req.resourceType, prevValue)}
                      </span>
                      <span className="mx-1.5">→</span>
                      <span className="font-semibold">
                        {formatValue(req.resourceType, req.value)}
                      </span>
                    </td>
                    <td className="max-w-[200px] px-5 py-4 text-muted-foreground">
                      <span className="line-clamp-2">{req.comment || '—'}</span>
                    </td>
                    <td className="px-5 py-4 text-xs text-muted-foreground">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={statusBadgeVariant(req.status)}>
                        {statusLabel(req.status)}
                      </Badge>
                    </td>
                    {showReview && (
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {req.adminComment || '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
