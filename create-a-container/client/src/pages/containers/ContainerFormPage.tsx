import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Spinner,
  Switch,
  Tooltip,
  useToast,
} from '@mieweb/ui';
import { Container, Dices, Plus, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { useSession } from '@/lib/auth';
import { FormPageHeader } from '@/components/FormPageHeader';
import { randomHostname } from '@/lib/randomHostname';
import { ResourcesSection } from '@/components/containers/ResourcesSection';
import { AddCollaboratorField, CollaboratorChips, CollaboratorsManager } from '@/components/containers/CollaboratorsManager';
import type { ContainerCreateResult, ContainerMetadata } from '@/lib/types';

function useDebouncedValue<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const SERVICE_TYPES = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS (backend TLS)' },
  { value: 'tcp', label: 'TCP' },
  { value: 'tls', label: 'TLS (backend TLS)' },
  { value: 'udp', label: 'UDP' },
  { value: 'srv', label: 'DNS (SRV record)' },
];

const serviceSchema = z
  .object({
    id: z.number().optional(),
    type: z.enum(['http', 'https', 'tcp', 'tls', 'udp', 'srv']),
    internalPort: z.string(),
    externalPort: z.number().optional(),
    externalHostname: z.string().optional(),
    externalDomainId: z.string().optional(),
    dnsName: z.string().optional(),
    authRequired: z.boolean().optional(),
    tls: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .refine(
    (s) =>
      s.deleted ||
      s.id !== undefined || // existing services are immutable here
      (s.type !== 'http' && s.type !== 'https') ||
      !!s.externalDomainId,
    {
      message: 'An external domain is required for HTTP services',
      path: ['externalDomainId'],
    },
  )
  .refine(
    (s) =>
      s.deleted ||
      s.id !== undefined || // existing services are immutable here
      (s.type !== 'tcp' && s.type !== 'tls') ||
      !s.tls ||
      !!s.externalDomainId,
    {
      message: 'An external domain is required when TLS termination is enabled',
      path: ['externalDomainId'],
    },
  );

const envVarSchema = z.object({ key: z.string(), value: z.string() });

const schema = z.object({
  hostname: z
    .string()
    .min(1, 'Required')
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
      'Only lowercase letters, digits, and hyphens; must start and end with a letter or digit (max 63 chars)',
    ),
  template: z.string().optional(),
  customTemplate: z.string().optional(),
  entrypoint: z.string().optional(),
  nvidiaRequested: z.boolean().optional(),
  restart: z.boolean().optional(),
  services: z.array(serviceSchema),
  environmentVars: z.array(envVarSchema),
  // Usernames to share a new container with (collaborators). Existence is
  // validated server-side on submit. Unused in edit mode (live manager instead).
  collaborators: z.array(z.string()),
});
type FormData = z.infer<typeof schema>;

const COMMON_TEMPLATES = [
  { value: 'ghcr.io/mieweb/opensource-server/base:latest', label: 'Debian 13' },
  { value: 'ghcr.io/mieweb/opensource-server/nodejs:latest', label: 'NodeJS 24' },
  { value: 'ghcr.io/mieweb/ozwell-studio:latest', label: 'Ozwell Studio' },
];

const sectionCardClass = 'overflow-hidden shadow-sm';
const sectionHeaderClass = 'flex flex-row items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-4';
const sectionContentClass = 'grid gap-4 px-6 py-6';

export function ContainerFormPage() {
  const { siteId, id } = useParams<{ siteId: string; id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();

  const { data: bootstrap, isLoading: bootstrapLoading } = useQuery({
    queryKey: keys.containerBootstrap(siteId!),
    queryFn: () => queries.containerBootstrap(siteId!),
    enabled: !!siteId,
  });
  const { data: container, isLoading: containerLoading } = useQuery({
    queryKey: keys.container(siteId!, id!),
    queryFn: () => queries.getContainer(siteId!, id!),
    enabled: isEdit,
  });
  // Collaborators get a read-only view of a shared container: the whole form is
  // disabled and the save footer hidden. The server enforces the same rule
  // (PUT is owner/admin only), so this is purely presentational.
  const isReadOnly =
    isEdit && !!container && !!session && !session.isAdmin && container.owner !== session.user;

  const { register, handleSubmit, control, reset, watch, setValue, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      services: [],
      environmentVars: [],
      collaborators: [],
      nvidiaRequested: false,
      restart: false,
    },
  });
  const services = useFieldArray({ control, name: 'services' });
  const envVars = useFieldArray({ control, name: 'environmentVars' });
  // Guards the one-time form initialization from the loaded container (edit).
  const initializedRef = useRef(false);

  // Default external domain for new HTTP services. The bootstrap endpoint
  // returns domains already sorted so the site's default domains come first,
  // then the first domain overall — mirroring the legacy form's selection.
  // An HTTP service must never render without a domain selected unless no
  // external domains are defined at all (then this is '' and the select is
  // empty + disabled).
  const defaultExternalDomainId = bootstrap?.externalDomains?.[0]?.id
    ? String(bootstrap.externalDomains[0].id)
    : '';
  const template = watch('template');
  const nvidiaRequested = watch('nvidiaRequested');
  const restart = watch('restart');
  const hostname = watch('hostname');
  const debouncedHostname = useDebouncedValue(hostname || '', 500);
  const customTemplate = watch('customTemplate');
  const collaborators = watch('collaborators') || [];

  useEffect(() => {
    if (container && isEdit && !initializedRef.current) {
      // Initialize the form from the loaded container exactly once. Re-running
      // reset on every `container` change would wipe unsaved edits whenever the
      // container query refetches (e.g. after the Sharing manager adds/removes a
      // collaborator and invalidates this query).
      initializedRef.current = true;
      reset({
        hostname: container.hostname,
        template: container.template || '',
        entrypoint: container.entrypoint || '',
        nvidiaRequested: container.nvidiaRequested,
        restart: false,
        services: container.services.map((s) => ({
          id: s.id,
          type:
            s.type === 'dns'
              ? 'srv'
              : s.type === 'http'
                ? s.httpService?.backendProtocol === 'https'
                  ? 'https'
                  : 'http'
                : s.transportService?.backendTls
                  ? 'tls'
                  : (s.transportService?.protocol ?? 'tcp'),
          internalPort: String(s.internalPort),
          externalPort: s.transportService?.externalPort,
          externalHostname:
            s.httpService?.externalHostname || s.transportService?.externalHostname || '',
          externalDomainId: s.httpService
            ? String(s.httpService.externalDomainId)
            : s.transportService?.externalDomainId
              ? String(s.transportService.externalDomainId)
              : '',
          dnsName: s.dnsService?.dnsName || '',
          authRequired: !!s.httpService?.authRequired,
          tls: !!s.transportService?.tls,
          deleted: false,
        })),
        environmentVars: Object.entries(container.environmentVars || {}).map(([key, value]) => ({
          key,
          value,
        })),
        collaborators: [],
      });
    }
  }, [container, isEdit, reset]);

  const [metadataMsg, setMetadataMsg] = useState<string | null>(null);
  const [nvidiaTooltipOpen, setNvidiaTooltipOpen] = useState(false);
  const metadataMutation = useMutation({
    mutationFn: (image: string) => queries.containerMetadata(siteId!, image),
    onSuccess: (meta: ContainerMetadata) => {
      // Replace any services/env vars from a previous metadata load (or
      // template switch) so re-fetching never duplicates entries.
      services.replace([]);
      envVars.replace([]);
      let added = 0;
      const baseHostname = hostname || '';
      (meta.httpServices || []).forEach((svc) => {
        // External hostname defaults to the container hostname, or to
        // "<hostname>-<suffix>" when the metadata label carries a
        // hostnameSuffix (mirrors the legacy form behavior).
        const externalHostname = svc.hostnameSuffix
          ? `${baseHostname}-${svc.hostnameSuffix}`
          : baseHostname;
        services.append({
          type: 'http' as FormData['services'][number]['type'],
          internalPort: String(svc.port),
          externalHostname,
          externalDomainId: defaultExternalDomainId,
          dnsName: '',
          authRequired: !!svc.requireAuth,
          deleted: false,
        });
        added += 1;
      });
      (meta.ports || []).forEach((p) => {
        const t = p.protocol === 'tcp' ? 'tcp' : p.protocol === 'udp' ? 'udp' : 'tcp';
        services.append({
          type: t as FormData['services'][number]['type'],
          internalPort: String(p.port),
          externalHostname: '',
          externalDomainId: '',
          dnsName: '',
          authRequired: false,
          tls: false,
          deleted: false,
        });
        added += 1;
      });
      if (meta.entrypoint) {
        setValue('entrypoint', meta.entrypoint);
      }
      if (meta.env && typeof meta.env === 'object') {
        Object.entries(meta.env).forEach(([key, value]) => {
          envVars.append({ key, value });
        });
      }
      setMetadataMsg(`Loaded metadata: ${added} port(s) discovered.`);
    },
    onError: (err: ApiError) =>
      setMetadataMsg(`${err.message} — Use "Fetch metadata" to try again.`),
  });

  // Tracks the last image we auto-fetched so blurring the custom-image input
  // without changing it doesn't trigger a redundant fetch.
  const lastAutoFetchedImage = useRef<string | null>(null);
  const handleCustomImageBlur = () => {
    if (isEdit || template !== 'custom') return;
    const img = (customTemplate || '').trim();
    if (!img || img === lastAutoFetchedImage.current) return;
    lastAutoFetchedImage.current = img;
    metadataMutation.mutate(img);
  };

  const mutation = useMutation({
    mutationFn: (values: FormData) => {
      const servicesObj: Record<string, unknown> = {};
      values.services.forEach((s, idx) => {
        if (s.deleted && s.id) {
          servicesObj[`s${idx}`] = { id: s.id, deleted: true };
          return;
        }
        if (s.deleted) return;
        const externalHostname = s.externalHostname?.trim();
        servicesObj[`s${idx}`] = {
          id: s.id,
          type: s.type,
          internalPort: s.internalPort ? parseInt(s.internalPort, 10) : undefined,
          externalHostname: externalHostname ? externalHostname : undefined,
          externalDomainId: s.externalDomainId ? parseInt(s.externalDomainId, 10) : undefined,
          dnsName: s.dnsName,
          authRequired: s.authRequired,
          tls: s.tls,
        };
      });
      const payload = {
        hostname: values.hostname,
        template: values.template === 'custom' ? values.customTemplate : values.template,
        customTemplate: values.customTemplate,
        entrypoint: values.entrypoint,
        nvidiaRequested: values.nvidiaRequested,
        services: servicesObj,
        environmentVars: values.environmentVars.filter((e) => e.key.trim()),
        restart: values.restart,
        // Only meaningful on create; the edit form manages sharing live.
        collaborators: values.collaborators,
      };
      type UpdateResult = {
        containerId: number;
        jobId: number | null;
        message: string;
        dnsWarnings: string[];
      };
      type SaveResult = UpdateResult | ContainerCreateResult;
      return (
        isEdit
          ? api.put<UpdateResult>(`/api/v1/sites/${siteId}/containers/${id}`, payload)
          : api.post<ContainerCreateResult>(`/api/v1/sites/${siteId}/containers`, payload)
      ) as Promise<SaveResult>;
    },
    onSuccess: (result) => {
      const dnsWarnings = (result as { dnsWarnings?: string[] }).dnsWarnings;
      toast.success(isEdit ? 'Container updated' : 'Container queued for creation');
      // exact:true so we only invalidate the list query and not its prefix
      // descendants (e.g. the still-mounted containerBootstrap query keyed
      // ['sites', siteId, 'containers', 'new']), which would otherwise refetch
      // GET /containers/new on this form right before we navigate away.
      qc.invalidateQueries({ queryKey: keys.containers(siteId!), exact: true });
      const jobId = (result as { jobId?: number | null }).jobId;
      if (jobId) {
        navigate(`/jobs/${jobId}`, { state: { dnsWarnings } });
      } else {
        navigate(`/sites/${siteId}/containers`, { state: { dnsWarnings } });
      }
    },
    onError: (err: ApiError) => {
      if (err.fields && Object.keys(err.fields).length > 0) {
        const detail = Object.entries(err.fields)
          .map(([f, m]) => `${f}: ${m}`)
          .join('; ');
        toast.error(`${err.message} — ${detail}`);
      } else {
        toast.error(err.message);
      }
    },
  });

  if ((isEdit && containerLoading) || bootstrapLoading) {
    return (
      <div className="flex justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  // No "— None —" option: an HTTP service must always have a domain selected
  // when any external domains exist. If none are defined, the list is empty.
  const domainOptions =
    bootstrap?.externalDomains.map((d) => ({ value: String(d.id), label: d.name })) || [];
  const templateOptions = [
    { value: '', label: 'Select a template' },
    ...COMMON_TEMPLATES.map((t) => ({ value: t.value, label: t.label })),
    { value: 'custom', label: 'Custom…' },
  ];

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <FormPageHeader
          icon={<Container className="size-6" />}
          title={isEdit ? `Edit container: ${container?.hostname ?? ''}` : 'New container'}
          subtitle={
            isEdit
              ? 'Update the container, its services, and environment variables.'
              : 'Configure a new container, expose services, and set environment variables.'
          }
          backTo={{ label: 'Back to containers', to: `/sites/${siteId}/containers` }}
        />

        {isReadOnly && (
          <Alert variant="info">
            <AlertDescription>
              This container is shared with you. Only the owner ({container?.owner}) can make
              changes.
            </AlertDescription>
          </Alert>
        )}

        <fieldset
          disabled={metadataMutation.isPending || isReadOnly}
          className={`flex flex-col gap-6 border-0 p-0 m-0 ${
            metadataMutation.isPending ? 'pointer-events-none opacity-60' : ''
          }`}
        >
        <Card padding="none" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className="text-base">Basics</CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Hostname"
                  required
                  disabled={isEdit}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  error={formState.errors.hostname?.message}
                  hasError={!!formState.errors.hostname}
                  {...register('hostname')}
                />
              </div>
              {!isEdit && (
                <Tooltip content="Generate random hostname">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label="Generate random hostname"
                    onClick={() => setValue('hostname', randomHostname())}
                  >
                    <Dices className="size-4" />
                  </Button>
                </Tooltip>
              )}
            </div>
            {!isEdit && (
              <>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Select
                      label="Template"
                      value={template || ''}
                      disabled={metadataMutation.isPending}
                      onValueChange={(v) => {
                        setValue('template', v);
                        setMetadataMsg(null);
                        // Selecting a built-in template (anything other than the
                        // empty placeholder or "custom") auto-loads its metadata,
                        // reusing the same mutation as the Fetch metadata button.
                        if (v && v !== 'custom') {
                          metadataMutation.mutate(v);
                        }
                      }}
                      options={templateOptions}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    leftIcon={<Search className="size-4" />}
                    isLoading={metadataMutation.isPending}
                    disabled={!(template === 'custom' ? customTemplate : template)}
                    onClick={() => {
                      const img = template === 'custom' ? customTemplate : template;
                      if (img) {
                        // Mark as fetched so the debounced custom-image effect
                        // doesn't immediately fire a duplicate request.
                        lastAutoFetchedImage.current = img.trim();
                        metadataMutation.mutate(img);
                      }
                    }}
                  >
                    Fetch metadata
                  </Button>
                </div>
                {template === 'custom' && (() => {
                  const customReg = register('customTemplate');
                  return (
                    <Input
                      label="Custom image"
                      helperText="Image reference, e.g. ghcr.io/org/image:tag"
                      placeholder="ghcr.io/org/image:tag"
                      disabled={metadataMutation.isPending}
                      {...customReg}
                      onBlur={(e) => {
                        customReg.onBlur(e);
                        handleCustomImageBlur();
                      }}
                    />
                  );
                })()}
                {metadataMsg && (
                  <p className="text-xs text-muted-foreground">{metadataMsg}</p>
                )}
              </>
            )}
            <Input
              label="Entrypoint"
              placeholder="Override container entrypoint"
              {...register('entrypoint')}
            />
            <div
              className="flex w-fit items-center gap-3"
              onMouseEnter={() => !bootstrap?.nvidiaAvailable && setNvidiaTooltipOpen(true)}
              onMouseLeave={() => setNvidiaTooltipOpen(false)}
              onFocus={() => !bootstrap?.nvidiaAvailable && setNvidiaTooltipOpen(true)}
              onBlur={() => setNvidiaTooltipOpen(false)}
            >
              <Switch
                id="nvidia-requested"
                checked={!!bootstrap?.nvidiaAvailable && !!nvidiaRequested}
                disabled={!bootstrap?.nvidiaAvailable}
                onCheckedChange={(c) => setValue('nvidiaRequested', c)}
              />
              <Tooltip
                content="No NVIDIA nodes are available in this site"
                disabled={!!bootstrap?.nvidiaAvailable}
                open={nvidiaTooltipOpen}
                onOpenChange={setNvidiaTooltipOpen}
              >
                <label htmlFor="nvidia-requested" className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium leading-none">Request NVIDIA GPU</span>
                  <span className="text-xs text-muted-foreground">
                    Schedule on a node with a GPU and pass it through
                  </span>
                </label>
              </Tooltip>
            </div>
            {isEdit && (
              <Switch
                label="Restart container after saving"
                description="Required if you change environment variables or entrypoint"
                checked={!!restart}
                onCheckedChange={(c) => setValue('restart', c)}
              />
            )}
          </CardContent>
        </Card>

        <Card padding="none" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className="text-base">Services</CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              leftIcon={<Plus className="size-4" />}
              onClick={() =>
                services.append({
                  type: 'http',
                  internalPort: '',
                  externalHostname: hostname || '',
                  externalDomainId: defaultExternalDomainId,
                  dnsName: '',
                  authRequired: false,
                  tls: false,
                  deleted: false,
                })
              }
            >
              Add service
            </Button>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            {services.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">No services defined.</p>
            )}
            {services.fields.map((f, idx) => {
              const svc = watch(`services.${idx}`);
              if (svc.deleted) return null;
              // Existing services (with id) are immutable except for
              // authRequired and delete — the API only accepts updates to
              // the auth flag. To change other fields, delete and re-add.
              const isExisting = !!svc.id;
              return (
                <div key={f.id} className="grid gap-3 rounded-lg border border-border p-4">
                  {isExisting && (
                    <p className="text-xs text-muted-foreground">
                      {svc.type === 'http' || svc.type === 'https'
                        ? 'Existing service — only Require authentication can be changed. Delete and re-add to modify other fields.'
                        : 'Existing service — fields cannot be changed. Delete and re-add to modify.'}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Select
                      label="Type"
                      value={svc.type}
                      onValueChange={(v) => {
                        const next = v as FormData['services'][number]['type'];
                        setValue(`services.${idx}.type`, next);
                        // When switching to an HTTP type, ensure a domain is
                        // selected (default to the site's first domain) so an
                        // HTTP service is never shown without one.
                        if (
                          (next === 'http' || next === 'https') &&
                          !svc.externalDomainId &&
                          defaultExternalDomainId
                        ) {
                          setValue(`services.${idx}.externalDomainId`, defaultExternalDomainId);
                        }
                      }}
                      options={SERVICE_TYPES}
                      disabled={isExisting}
                    />
                    <Input
                      label="Internal port"
                      type="number"
                      inputMode="numeric"
                      readOnly={isExisting}
                      {...register(`services.${idx}.internalPort`)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (svc.id) setValue(`services.${idx}.deleted`, true);
                        else services.remove(idx);
                      }}
                      aria-label="Remove service"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {(svc.type === 'http' || svc.type === 'https') && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="External hostname"
                        placeholder="app"
                        readOnly={isExisting}
                        {...register(`services.${idx}.externalHostname`)}
                      />
                      <Select
                        label="External domain"
                        value={svc.externalDomainId || ''}
                        onValueChange={(v) =>
                          setValue(`services.${idx}.externalDomainId`, v)
                        }
                        options={domainOptions}
                        disabled={isExisting}
                      />
                      <Switch
                        label="Require authentication"
                        checked={!!svc.authRequired}
                        onCheckedChange={(c) =>
                          setValue(`services.${idx}.authRequired`, c)
                        }
                      />
                    </div>
                  )}
                  {(svc.type === 'tcp' || svc.type === 'tls' || svc.type === 'udp') && (
                    <div className="grid gap-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          External port
                        </p>
                        <p className="font-mono text-sm">
                          {svc.externalPort ?? (
                            <span className="text-muted-foreground">
                              Auto-assigned on save
                            </span>
                          )}
                        </p>
                      </div>
                      {(svc.type === 'tcp' || svc.type === 'tls') && (
                        <>
                          <Switch
                            label="Terminate TLS at load balancer"
                            checked={!!svc.tls}
                            disabled={isExisting}
                            onCheckedChange={(c) => {
                              setValue(`services.${idx}.tls`, c);
                              // Ensure a domain is selected when enabling TLS so
                              // the load balancer has a certificate to use.
                              if (c && !svc.externalDomainId && defaultExternalDomainId) {
                                setValue(
                                  `services.${idx}.externalDomainId`,
                                  defaultExternalDomainId,
                                );
                              }
                            }}
                          />
                          {svc.tls && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Input
                                label="External hostname"
                                placeholder="db"
                                readOnly={isExisting}
                                {...register(`services.${idx}.externalHostname`)}
                              />
                              <Select
                                label="External domain"
                                value={svc.externalDomainId || ''}
                                onValueChange={(v) =>
                                  setValue(`services.${idx}.externalDomainId`, v)
                                }
                                options={domainOptions}
                                disabled={isExisting}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {svc.type === 'srv' && (
                    <Input
                      label="DNS name"
                      placeholder="_service._tcp.example"
                      readOnly={isExisting}
                      {...register(`services.${idx}.dnsName`)}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <ResourcesSection
          siteId={siteId!}
          hostname={debouncedHostname}
          owner={isEdit ? container?.owner : undefined}
          isNewContainer={!isEdit}
          sectionCardClass={sectionCardClass}
          sectionHeaderClass={sectionHeaderClass}
          sectionContentClass={sectionContentClass}
        />

        <Card padding="none" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className="text-base">Environment variables</CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              leftIcon={<Plus className="size-4" />}
              onClick={() => envVars.append({ key: '', value: '' })}
            >
              Add variable
            </Button>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            {envVars.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">No environment variables.</p>
            )}
            {envVars.fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  label={idx === 0 ? 'Key' : undefined}
                  hideLabel={idx !== 0}
                  placeholder="KEY"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  {...register(`environmentVars.${idx}.key`)}
                />
                <Input
                  label={idx === 0 ? 'Value' : undefined}
                  hideLabel={idx !== 0}
                  placeholder="value"
                  autoCorrect="off"
                  spellCheck={false}
                  {...register(`environmentVars.${idx}.value`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="self-end"
                  onClick={() => envVars.remove(idx)}
                  aria-label="Remove"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card padding="none" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className="text-base">Sharing</CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            {isEdit && container ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Share this container with other users for collaboration. They will see it in
                  their All containers tab.
                </p>
                <CollaboratorsManager
                  siteId={siteId!}
                  containerId={container.id}
                  collaborators={container.collaborators}
                />
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Optionally add other users as collaborators. They will see this container in
                  their All containers tab once it is created.
                </p>
                <CollaboratorChips
                  usernames={collaborators}
                  emptyText="No collaborators."
                  onRemove={(u) =>
                    setValue(
                      'collaborators',
                      collaborators.filter((x) => x !== u),
                    )
                  }
                />
                <AddCollaboratorField
                  label="Collaborator"
                  onAdd={(u) => {
                    if (!collaborators.includes(u)) {
                      setValue('collaborators', [...collaborators, u]);
                    }
                  }}
                />
              </>
            )}
          </CardContent>
          {!isReadOnly && (
            <CardFooter className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(`/sites/${siteId}/containers`)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={mutation.isPending}>
                {isEdit ? 'Save changes' : 'Create container'}
              </Button>
            </CardFooter>
          )}
        </Card>
        </fieldset>

        {mutation.error && (
          <Alert variant="danger">
            <AlertDescription>{(mutation.error as ApiError).message}</AlertDescription>
          </Alert>
        )}
      </div>
    </form>
  );
}
