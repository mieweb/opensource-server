import { useMemo, useState } from 'react';
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
import { STATUS_LABELS } from '@/components/containers/StatusBadge';
import { templateTitle } from '@/components/containers/shared';
import { CollaboratorsManager } from '@/components/containers/CollaboratorsManager';
import { ContainersDataGrid } from '@/components/containers/ContainersDataGrid';
import { ContainerFilters, type FilterOption } from '@/components/containers/ContainerFilters';
import type { Container, ContainerStatus } from '@/lib/types';

export function ContainersListPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const sessionUser = session?.user;
  const isAdmin = !!session?.isAdmin;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const nodeId = searchParams.get('nodeId') || undefined;
  // The URL is the single source of truth for the filter bar, so views are
  // bookmarkable and shareable. `user` is a comma-separated owner list that
  // drives the server query; an empty list returns everything the caller may
  // see (all owners for admins; own + shared for non-admins).
  // Status/template/hostname refine the loaded rows client-side.
  const parseList = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
  const selectedUsers = parseList(searchParams.get('user'));
  const selectedStatuses = parseList(searchParams.get('status'));
  const selectedTemplates = parseList(searchParams.get('template'));
  const hostnameQuery = searchParams.get('q') ?? '';
  // The default (and a self-only filter) shows only the caller's containers, so
  // the owner column only appears once another user is included in the filter.
  const showOwner = selectedUsers.some((u) => u !== sessionUser);
  const dnsWarnings = (location.state as { dnsWarnings?: string[] } | null)?.dnsWarnings;

  const setListParam = (key: string, values: string[]) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (values.length > 0) next.set(key, values.join(','));
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const setTextParam = (key: string, value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  // Clearing all filters returns to the default view: the caller's own
  // containers.
  const clearAllFilters = () =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        ['user', 'status', 'template', 'q'].forEach((k) => next.delete(k));
        return next;
      },
      { replace: true },
    );

  // Container whose sharing dialog is open. Tracked by id so the dialog reflects
  // live collaborator changes after the list query refetches.
  const [shareTargetId, setShareTargetId] = useState<number | null>(null);

  const { data: site } = useQuery({
    queryKey: keys.site(siteId!),
    queryFn: () => queries.getSite(siteId!),
    enabled: !!siteId,
  });
  // Empty selection defaults to the caller's own containers server-side.
  const userParam = selectedUsers.length > 0 ? selectedUsers : undefined;
  const { data, isLoading, error } = useQuery({
    queryKey: keys.containers(siteId!, { user: userParam, nodeId }),
    queryFn: () => queries.listContainers(siteId!, { user: userParam, nodeId }),
    enabled: !!siteId,
  });

  // Options for the "User" filter. Admins may filter by any user; non-admins
  // may only narrow to owners who have shared a container with them, so their
  // option list is derived from a `*` (own + shared) query — distinct from the
  // own-only default list, so both run.
  const { data: allUsers } = useQuery({
    queryKey: keys.users(),
    queryFn: queries.listUsers,
    enabled: !!siteId && isAdmin,
  });
  const { data: visibleContainers } = useQuery({
    queryKey: keys.containers(siteId!, { user: ['*'] }),
    queryFn: () => queries.listContainers(siteId!, { user: ['*'] }),
    enabled: !!siteId && !isAdmin,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sites/${siteId}/containers/${id}`),
    onSuccess: () => {
      toast.success('Container deleted');
      qc.invalidateQueries({ queryKey: keys.containers(siteId!) });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  // Client-side refinement of the loaded rows by status/template/hostname.
  const visible = useMemo(() => {
    const q = hostnameQuery.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (selectedStatuses.length === 0 || selectedStatuses.includes(c.status)) &&
        (selectedTemplates.length === 0 ||
          (c.template != null && selectedTemplates.includes(c.template))) &&
        (q === '' || c.hostname.toLowerCase().includes(q)),
    );
  }, [data, selectedStatuses, selectedTemplates, hostnameQuery]);

  const userOptions = useMemo<FilterOption[]>(() => {
    const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label);
    if (isAdmin) {
      const opts = (allUsers ?? []).map((u) => ({
        value: u.uid,
        label: u.uid === sessionUser ? `${u.cn} (me)` : u.cn,
      }));
      return opts.sort(byLabel);
    }
    const owners = new Set<string>();
    if (sessionUser) owners.add(sessionUser);
    (visibleContainers ?? []).forEach((c) => owners.add(c.owner));
    const opts = [...owners].map((o) => ({
      value: o,
      label: o === sessionUser ? `${o} (me)` : o,
    }));
    return opts.sort(byLabel);
  }, [isAdmin, allUsers, visibleContainers, sessionUser]);

  // Only offer statuses that actually occur in the loaded rows, so the
  // dropdown stays clean instead of listing every theoretical status.
  const statusOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<ContainerStatus>();
    (data ?? []).forEach((c) => seen.add(c.status));
    return [...seen]
      .map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const templateOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>();
    (data ?? []).forEach((c) => {
      if (c.template) seen.set(c.template, templateTitle(c.template));
    });
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const hasContainers = visible.length > 0;
  const serverHasContainers = !!data && data.length > 0;

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

      <ContainerFilters
        userOptions={userOptions}
        selectedUsers={selectedUsers}
        onUsersChange={(v) => setListParam('user', v)}
        statusOptions={statusOptions}
        selectedStatuses={selectedStatuses}
        onStatusesChange={(v) => setListParam('status', v)}
        templateOptions={templateOptions}
        selectedTemplates={selectedTemplates}
        onTemplatesChange={(v) => setListParam('template', v)}
        hostname={hostnameQuery}
        onHostnameChange={(v) => setTextParam('q', v)}
        onClearAll={clearAllFilters}
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
            {selectedUsers.length > 0
              ? 'No containers match the selected users.'
              : 'Create your first container with the button above.'}
          </AlertDescription>
        </Alert>
      )}
      {serverHasContainers && !hasContainers && (
        <Alert variant="info">
          <AlertTitle>No matches</AlertTitle>
          <AlertDescription>No containers match the current filters.</AlertDescription>
        </Alert>
      )}

      {hasContainers && (
        <ContainersDataGrid
          containers={visible}
          showOwner={showOwner}
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
