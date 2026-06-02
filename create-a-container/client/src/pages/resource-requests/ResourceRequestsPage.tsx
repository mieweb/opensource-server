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

  const { data: requests, isLoading } = useQuery({
    queryKey: keys.resourceRequests('pending'),
    queryFn: () => queries.listResourceRequests('pending'),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, adminComment }: { id: number; adminComment?: string }) =>
      api.put<ResourceRequest>(`/api/v1/resource-requests/${id}/approve`, { adminComment }),
    onSuccess: () => {
      toast.success('Request approved');
      qc.invalidateQueries({ queryKey: keys.resourceRequests('pending') });
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
      qc.invalidateQueries({ queryKey: keys.resourceRequestCount() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <FormPageHeader
        icon={<ClipboardList className="size-6" />}
        title="Open Requests"
        subtitle="Review and approve or deny resource requests from users."
      />

      {(!requests || requests.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No pending requests.
          </CardContent>
        </Card>
      )}

      {requests && requests.length > 0 && (
        <Card padding="none">
          <CardHeader className="border-b border-border bg-muted/30 px-6 py-4">
            <CardTitle className="text-base">
              Pending Requests
              <Badge variant="secondary" className="ml-2">
                {requests.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table" aria-label="Pending resource requests">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="px-5 py-3.5 text-left font-medium">Container</th>
                    <th className="px-5 py-3.5 text-left font-medium">User</th>
                    <th className="px-5 py-3.5 text-left font-medium">Resource Type</th>
                    <th className="px-5 py-3.5 text-left font-medium">Amount</th>
                    <th className="px-5 py-3.5 text-left font-medium">Comment</th>
                    <th className="px-5 py-3.5 text-left font-medium">Requested</th>
                    <th className="px-5 py-3.5 text-left font-medium">Admin Response</th>
                    <th className="px-5 py-3.5 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => {
                    const prevValue = RESOURCE_DEFAULTS[req.resourceType] ?? 0;
                    return (
                      <tr key={req.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-4 font-mono text-xs">{req.hostname}</td>
                        <td className="px-5 py-4">{req.requestedBy}</td>
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
                            size="sm"
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
    </div>
  );
}
