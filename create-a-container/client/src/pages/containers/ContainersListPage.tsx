import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Modal,
  ModalBody,
  ModalClose,
  ModalHeader,
  ModalTitle,
  PageHeader,
  Spinner,
  useToast,
} from '@mieweb/ui';
import { Container as ContainerIcon, Plus, Server } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { keys, queries } from '@/lib/queries';
import { ButtonLink } from '@/components/ButtonLink';
import { CollaboratorsManager } from '@/components/containers/CollaboratorsManager';
import { ContainersDataGrid } from '@/components/containers/ContainersDataGrid';
import type { Container } from '@/lib/types';

export function ContainersListPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const sessionUser = session?.user;
  const isAdmin = !!session?.isAdmin;
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Preserved so a node's "view containers" link can scope the list to one node.
  const nodeId = searchParams.get('nodeId') || undefined;
  const dnsWarnings = (location.state as { dnsWarnings?: string[] } | null)?.dnsWarnings;

  // Container whose sharing dialog is open. Tracked by id so the dialog reflects
  // live collaborator changes after the list query refetches.
  const [shareTargetId, setShareTargetId] = useState<number | null>(null);

  const { data: site } = useQuery({
    queryKey: keys.site(siteId!),
    queryFn: () => queries.getSite(siteId!),
    enabled: !!siteId,
  });
  // Load everything the caller may see (own + shared, and every owner for
  // admins) in one query; all narrowing now happens through the DataVis grid's
  // built-in column filters and search, so there is no separate filter bar.
  const { data, isLoading, error } = useQuery({
    queryKey: keys.containers(siteId!, { user: ['*'], nodeId }),
    queryFn: () => queries.listContainers(siteId!, { user: ['*'], nodeId }),
    enabled: !!siteId,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sites/${siteId}/containers/${id}`),
    onSuccess: () => {
      toast.success('Container deleted');
      qc.invalidateQueries({ queryKey: keys.containers(siteId!) });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const containers = data ?? [];
  const hasContainers = containers.length > 0;

  // Sharing is owner/admin only. Derive the open dialog's container from the
  // live list so its collaborator chips update after add/remove.
  const canShareContainer = (c: Container) => isAdmin || c.owner === sessionUser;
  const shareTarget = data?.find((c) => c.id === shareTargetId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Containers"
        subtitle={site ? `Site: ${site.name}` : undefined}
        icon={<ContainerIcon className="size-6" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink as={Link} to={`/sites/${siteId}/nodes`} variant="ghost" aria-label="Nodes" leftIcon={<Server className="size-4" />}>
              <span className="hidden sm:inline">Nodes</span>
            </ButtonLink>
            <ButtonLink as={Link} to={`/sites/${siteId}/containers/new`} variant="primary" aria-label="New container" leftIcon={<Plus className="size-4" />}>
              <span className="hidden sm:inline">New container</span>
            </ButtonLink>
          </div>
        }
      />

      {error && (
        <Alert variant="danger">
          <AlertDescription>{(error as ApiError).message}</AlertDescription>
        </Alert>
      )}
      {dnsWarnings && dnsWarnings.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>DNS warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {dnsWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {isLoading && (
        <div className="flex justify-center p-12">
          <Spinner size="lg" />
        </div>
      )}
      {data && data.length === 0 && (
        <Alert variant="info">
          <AlertTitle>No containers</AlertTitle>
          <AlertDescription>
            Create your first container with the button above.
          </AlertDescription>
        </Alert>
      )}

      {hasContainers && (
        <ContainersDataGrid
          containers={containers}
          sessionUser={sessionUser}
          siteId={siteId}
          onDelete={del.mutate}
          deleting={del.isPending}
          canShare={canShareContainer}
          onShare={(target) => setShareTargetId(target.id)}
        />
      )}

      <Modal
        open={shareTarget !== null}
        onOpenChange={(open) => !open && setShareTargetId(null)}
        size="md"
      >
        <ModalHeader>
          <ModalTitle>
            {shareTarget ? `Share ${shareTarget.hostname}` : 'Share container'}
          </ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Share this container with other users for collaboration. Shared users can find it
            by filtering the containers list by your username.
          </p>
          {shareTarget && siteId && (
            <CollaboratorsManager
              siteId={siteId}
              containerId={shareTarget.id}
              collaborators={shareTarget.collaborators}
            />
          )}
        </ModalBody>
      </Modal>
    </div>
  );
}
