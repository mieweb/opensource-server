import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@mieweb/ui';
import { CheckCircle, XCircle, ClipboardList } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { FormPageHeader } from '@/components/FormPageHeader';
import type { ResourceRequest } from '@/lib/types';

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

export function ResourceRequestsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adminComments, setAdminComments] = useState<Record<number, string>>({});

  const { data: pendingRequests, isLoading: pendingLoading } = useQuery({
    queryKey: keys.resourceRequests('pending'),
    queryFn: () => queries.listResourceRequests('pending'),
  });

  const { data: closedRequests, isLoading: closedLoading } = useQuery({
    queryKey: keys.resourceRequests('closed'),
    queryFn: () => queries.listResourceRequests('closed'),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, adminComment }: { id: number; adminComment?: string }) =>
      api.put<ResourceRequest>(`/api/v1/resource-requests/${id}/approve`, { adminComment }),
    onSuccess: () => {
      toast.success('Request approved');
      qc.invalidateQueries({ queryKey: keys.resourceRequests('pending') });
      qc.invalidateQueries({ queryKey: keys.resourceRequests('closed') });
      qc.invalidateQueries({ queryKey: keys.resourceRequestCount() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const denyMutation = useMutation({
    mutationFn: ({ id, adminComment }: { id: number; adminComment?: string }) =>
      api.put<ResourceRequest>(`/api/v1/resource-requests/${id}/deny`, { adminComment }),
    onSuccess: () => {
      toast.success('Request denied');
      qc.invalidateQueries({ queryKey: keys.resourceRequests('pending') });
      qc.invalidateQueries({ queryKey: keys.resourceRequests('closed') });
      qc.invalidateQueries({ queryKey: keys.resourceRequestCount() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <FormPageHeader
        icon={<ClipboardList className="size-6" />}
        title="Resource Requests"
        subtitle="Review and approve or deny resource requests from users."
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
          <TabsTrigger value="closed">Closed</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {pendingLoading ? (
            <div className="flex justify-center p-12"><Spinner size="lg" /></div>
          ) : (!pendingRequests || pendingRequests.length === 0) ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No pending requests.
              </CardContent>
            </Card>
          ) : (
            <Card padding="none">
              <CardHeader className="border-b border-border bg-muted/30 px-6 py-4">
                <CardTitle className="text-base">Pending Requests</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table" aria-label="Pending resource requests">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="w-36 px-5 py-3.5 text-left font-medium">Site</th>
                        <th className="w-40 px-5 py-3.5 text-left font-medium">Container</th>
                        <th className="w-36 px-5 py-3.5 text-left font-medium">User</th>
                        <th className="w-32 px-5 py-3.5 text-left font-medium">Resource</th>
                        <th className="w-36 px-5 py-3.5 text-left font-medium">Amount</th>
                        <th className="w-48 px-5 py-3.5 text-left font-medium">Comment</th>
                        <th className="w-32 px-5 py-3.5 text-left font-medium">Requested</th>
                        <th className="min-w-[220px] px-5 py-3.5 text-left font-medium">Admin Response</th>
                        <th className="w-44 px-5 py-3.5 text-left font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingRequests.map((req) => {
                        const prevValue = RESOURCE_DEFAULTS[req.resourceType] ?? 0;
                        return (
                          <tr key={req.id} className="border-b border-border last:border-0">
                            <td className="px-5 py-4 text-xs text-muted-foreground">{req.site?.name ?? '—'}</td>
                            <td className="px-5 py-4 font-mono text-xs">{req.hostname}</td>
                            <td className="px-5 py-4">{req.username}</td>
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
                              <Input
                                placeholder="Comment (optional)"
                                value={adminComments[req.id] || ''}
                                onChange={(e) =>
                                  setAdminComments((prev) => ({
                                    ...prev,
                                    [req.id]: e.target.value,
                                  }))
                                }
                                aria-label={`Admin comment for request ${req.id}`}
                              />
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="primary"
                                  leftIcon={<CheckCircle className="size-3.5" />}
                                  isLoading={approveMutation.isPending}
                                  onClick={() =>
                                    approveMutation.mutate({
                                      id: req.id,
                                      adminComment: adminComments[req.id],
                                    })
                                  }
                                  aria-label={`Approve request for ${req.hostname}`}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  leftIcon={<XCircle className="size-3.5" />}
                                  isLoading={denyMutation.isPending}
                                  onClick={() =>
                                    denyMutation.mutate({
                                      id: req.id,
                                      adminComment: adminComments[req.id],
                                    })
                                  }
                                  aria-label={`Deny request for ${req.hostname}`}
                                >
                                  Deny
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          {closedLoading ? (
            <div className="flex justify-center p-12"><Spinner size="lg" /></div>
          ) : (!closedRequests || closedRequests.length === 0) ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No closed requests.
              </CardContent>
            </Card>
          ) : (
            <Card padding="none">
              <CardHeader className="border-b border-border bg-muted/30 px-6 py-4">
                <CardTitle className="text-base">Request History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table" aria-label="Closed resource requests">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="w-36 px-5 py-3.5 text-left font-medium">Site</th>
                        <th className="w-40 px-5 py-3.5 text-left font-medium">Container</th>
                        <th className="w-36 px-5 py-3.5 text-left font-medium">User</th>
                        <th className="w-32 px-5 py-3.5 text-left font-medium">Resource</th>
                        <th className="w-36 px-5 py-3.5 text-left font-medium">Amount</th>
                        <th className="w-48 px-5 py-3.5 text-left font-medium">Comment</th>
                        <th className="w-32 px-5 py-3.5 text-left font-medium">Requested</th>
                        <th className="w-32 px-5 py-3.5 text-left font-medium">Status</th>
                        <th className="w-36 px-5 py-3.5 text-left font-medium">Reviewed By</th>
                        <th className="min-w-[180px] px-5 py-3.5 text-left font-medium">Admin Response</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedRequests.map((req) => {
                        const prevValue = RESOURCE_DEFAULTS[req.resourceType] ?? 0;
                        const isApproved = req.status === 'approved';
                        return (
                          <tr key={req.id} className="border-b border-border last:border-0">
                            <td className="px-5 py-4 text-xs text-muted-foreground">{req.site?.name ?? '—'}</td>
                            <td className="px-5 py-4 font-mono text-xs">{req.hostname}</td>
                            <td className="px-5 py-4">{req.username}</td>
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
                              <Badge variant={isApproved ? 'success' : 'danger'}>
                                {isApproved ? 'Approved' : 'Denied'}
                              </Badge>
                            </td>
                            <td className="px-5 py-4 text-xs text-muted-foreground">
                              {req.reviewedBy || '—'}
                            </td>
                            <td className="px-5 py-4 text-xs text-muted-foreground">
                              {req.adminComment || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
