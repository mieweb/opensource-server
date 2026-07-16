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
import { Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { useSession } from '@/lib/auth';
import type { EffectiveResources, ResourceRequest } from '@/lib/types';

const RESOURCE_OPTIONS = [
  { key: 'memory', label: 'RAM', unit: 'MB', step: 512, min: 256 },
  { key: 'swap', label: 'Swap', unit: 'MB', step: 512, min: 0 },
  { key: 'cpus', label: 'CPUs', unit: '', step: 1, min: 1 },
  { key: 'rootfs', label: 'RootFS Storage', unit: 'GB', step: 10, min: 5 },
] as const;

const DEFAULTS: EffectiveResources = { memory: 4096, swap: 0, cpus: 4, rootfs: 50 };

interface ResourcesSectionProps {
  siteId: string;
  hostname: string;
  username?: string;
  /**
   * The container's owner (uid). When set and different from the session user
   * (i.e. the viewer is a collaborator on a shared container), resource
   * requests are disabled — requests are keyed to the requesting user, so only
   * the owner's requests can apply to the container.
   */
  owner?: string;
  isNewContainer?: boolean;
  sectionCardClass: string;
  sectionHeaderClass: string;
  sectionContentClass: string;
}

export function ResourcesSection({
  siteId,
  hostname,
  username,
  owner,
  isNewContainer,
  sectionCardClass,
  sectionHeaderClass,
  sectionContentClass,
}: ResourcesSectionProps) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const currentUser = username || session?.user || '';
  const isOwner = !owner || owner === session?.user;
  const [pendingNote, setPendingNote] = useState<string | null>(null);

  const { data: effective, isLoading } = useQuery({
    queryKey: keys.effectiveResources(siteId, hostname, currentUser),
    queryFn: () => queries.getEffectiveResources(siteId, hostname, currentUser),
    enabled: !!siteId && !!hostname && !!currentUser && isOwner,
  });

  const [editingResource, setEditingResource] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [comment, setComment] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: { resourceType: string; value: number; comment: string }) =>
      api.post<ResourceRequest>('/api/v1/resource-requests', {
        siteId: parseInt(siteId, 10),
        hostname,
        resourceType: payload.resourceType,
        value: payload.value,
        comment: payload.comment || undefined,
      }),
    onSuccess: (result) => {
      if (result.status === 'approved') {
        toast.success('Resource updated (auto-approved)');
        setPendingNote(null);
      } else {
        toast.success('Resource request submitted for admin approval');
        if (isNewContainer) {
          setPendingNote(
            'This container will be created with default resources. Once your request is approved, the updated value will apply automatically.',
          );
        }
      }
      setEditingResource(null);
      setComment('');
      qc.invalidateQueries({ queryKey: keys.effectiveResources(siteId, hostname, currentUser) });
      qc.invalidateQueries({ queryKey: keys.resourceRequestCount() });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const resources = effective || DEFAULTS;

  if (!hostname) {
    return (
      <Card padding="none" className={sectionCardClass}>
        <CardHeader className={sectionHeaderClass}>
          <CardTitle className="text-base">Resources</CardTitle>
        </CardHeader>
        <CardContent className={sectionContentClass}>
          <p className="text-sm text-muted-foreground">
            Enter a hostname to configure resources.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card padding="none" className={sectionCardClass}>
        <CardHeader className={sectionHeaderClass}>
          <CardTitle className="text-base">Resources</CardTitle>
        </CardHeader>
        <CardContent className={sectionContentClass}>
          <div className="flex justify-center py-4">
            <Spinner size="sm" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card padding="none" className={sectionCardClass}>
      <CardHeader className={sectionHeaderClass}>
        <CardTitle className="text-base">Resources</CardTitle>
      </CardHeader>
      <CardContent className={sectionContentClass}>
        <p className="text-xs text-muted-foreground">
          Resource allocations for this container. Changes above the default require admin approval.
        </p>
        {!isOwner && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Only owners can make resource requests on their containers.
          </p>
        )}
        {pendingNote && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300/80">
            {pendingNote}
          </p>
        )}
        <div className="grid gap-3">
          {RESOURCE_OPTIONS.map((opt) => {
            const currentValue = resources[opt.key as keyof EffectiveResources];
            const isEditing = editingResource === opt.key;
            const isDefault = currentValue === DEFAULTS[opt.key as keyof EffectiveResources];

            return (
              <div
                key={opt.key}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{opt.label}</span>
                    {isDefault && (
                      <Badge variant="secondary" className="text-[10px]">
                        default
                      </Badge>
                    )}
                  </div>
                  {!isEditing && (
                    <span className="text-sm text-muted-foreground">
                      {currentValue}
                      {opt.unit ? ` ${opt.unit}` : ''}
                    </span>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Input
                      type="number"
                      size="sm"
                      min={opt.min}
                      step={opt.step}
                      value={editValue}
                      onChange={(e) => setEditValue(parseInt(e.target.value, 10) || 0)}
                      className="w-24"
                      aria-label={`New ${opt.label} value`}
                    />
                    {opt.unit && (
                      <span className="text-xs text-muted-foreground">{opt.unit}</span>
                    )}
                    <Input
                      placeholder="Reason (optional)"
                      size="sm"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      className="w-48"
                      aria-label="Reason for request"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      leftIcon={<Save className="size-3.5" />}
                      isLoading={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          resourceType: opt.key,
                          value: editValue,
                          comment,
                        })
                      }
                    >
                      Request
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingResource(null);
                        setComment('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!isOwner}
                    onClick={() => {
                      setEditingResource(opt.key);
                      setEditValue(currentValue);
                      setComment('');
                    }}
                  >
                    Change
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
