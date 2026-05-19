import { useEffect, useState } from 'react';
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
  useToast,
} from '@mieweb/ui';
import { Container, Plus, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { FormPageHeader } from '@/components/FormPageHeader';
import type { ContainerCreateResult, ContainerMetadata } from '@/lib/types';

const SERVICE_TYPES = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS (backend TLS)' },
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'srv', label: 'DNS (SRV record)' },
];

const serviceSchema = z.object({
  id: z.number().optional(),
  type: z.enum(['http', 'https', 'tcp', 'udp', 'srv']),
  internalPort: z.string(),
  externalHostname: z.string().optional(),
  externalDomainId: z.string().optional(),
  dnsName: z.string().optional(),
  authRequired: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

const envVarSchema = z.object({ key: z.string(), value: z.string() });

const schema = z.object({
  hostname: z.string().min(1, 'Required'),
  template: z.string().optional(),
  customTemplate: z.string().optional(),
  entrypoint: z.string().optional(),
  nvidiaRequested: z.boolean().optional(),
  restart: z.boolean().optional(),
  services: z.array(serviceSchema),
  environmentVars: z.array(envVarSchema),
});
type FormData = z.infer<typeof schema>;

const COMMON_TEMPLATES = [
  'ubuntu-22.04-standard',
  'ubuntu-24.04-standard',
  'debian-12-standard',
  'docker:nginx:latest',
  'docker:postgres:16',
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

  const { data: bootstrap, isLoading: bootstrapLoading } = useQuery({
    queryKey: keys.containerBootstrap(siteId!),
    queryFn: () => queries.containerBootstrap(siteId!),
    enabled: !!siteId,
  });
  const { data: container, isLoading: containerLoading } = useQuery({
    queryKey: keys.container(siteId!, id ?? 'new'),
    queryFn: () => queries.getContainer(siteId!, id!),
    enabled: isEdit,
  });

  const { register, handleSubmit, control, reset, watch, setValue, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      services: [],
      environmentVars: [],
      nvidiaRequested: false,
      restart: false,
    },
  });
  const services = useFieldArray({ control, name: 'services' });
  const envVars = useFieldArray({ control, name: 'environmentVars' });
  const template = watch('template');
  const nvidiaRequested = watch('nvidiaRequested');
  const restart = watch('restart');

  useEffect(() => {
    if (container && isEdit) {
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
                : (s.transportService?.protocol ?? 'tcp'),
          internalPort: String(s.internalPort),
          externalHostname: s.httpService?.externalHostname || '',
          externalDomainId: s.httpService ? String(s.httpService.externalDomainId) : '',
          dnsName: s.dnsService?.dnsName || '',
          authRequired: !!s.httpService?.authRequired,
          deleted: false,
        })),
        environmentVars: Object.entries(container.environmentVars || {}).map(([key, value]) => ({
          key,
          value,
        })),
      });
    }
  }, [container, isEdit, reset]);

  const [metadataMsg, setMetadataMsg] = useState<string | null>(null);
  const metadataMutation = useMutation({
    mutationFn: (image: string) => queries.containerMetadata(siteId!, image),
    onSuccess: (meta: ContainerMetadata) => {
      const ports = (meta.exposedPorts || []).filter((p) => /^\d+(\/\w+)?$/.test(p));
      let added = 0;
      ports.forEach((p) => {
        const [portStr, proto] = p.split('/');
        const port = parseInt(portStr, 10);
        const t = !proto || proto === 'tcp' ? 'http' : 'tcp';
        services.append({
          type: t as FormData['services'][number]['type'],
          internalPort: String(port),
          externalHostname: '',
          externalDomainId: '',
          dnsName: '',
          authRequired: false,
          deleted: false,
        });
        added += 1;
      });
      if (meta.entrypoint) {
        const ep = Array.isArray(meta.entrypoint) ? meta.entrypoint.join(' ') : meta.entrypoint;
        setValue('entrypoint', ep);
      }
      if (Array.isArray(meta.env)) {
        meta.env.forEach((e) => {
          const eq = e.indexOf('=');
          if (eq > 0) envVars.append({ key: e.slice(0, eq), value: e.slice(eq + 1) });
        });
      }
      setMetadataMsg(`Loaded metadata: ${added} port(s) discovered.`);
    },
    onError: (err: ApiError) => setMetadataMsg(err.message),
  });

  const mutation = useMutation({
    mutationFn: (values: FormData) => {
      const servicesObj: Record<string, unknown> = {};
      values.services.forEach((s, idx) => {
        if (s.deleted && s.id) {
          servicesObj[`s${idx}`] = { id: s.id, deleted: true };
          return;
        }
        if (s.deleted) return;
        servicesObj[`s${idx}`] = {
          id: s.id,
          type: s.type,
          internalPort: s.internalPort ? parseInt(s.internalPort, 10) : undefined,
          externalHostname: s.externalHostname,
          externalDomainId: s.externalDomainId ? parseInt(s.externalDomainId, 10) : undefined,
          dnsName: s.dnsName,
          authRequired: s.authRequired,
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
      if (dnsWarnings && dnsWarnings.length > 0) {
        toast.warning(`Saved with DNS warnings: ${dnsWarnings.join('; ')}`);
      } else {
        toast.success(isEdit ? 'Container updated' : 'Container queued for creation');
      }
      qc.invalidateQueries({ queryKey: keys.containers(siteId!) });
      const jobId = (result as { jobId?: number | null }).jobId;
      if (jobId) {
        navigate(`/jobs/${jobId}`);
      } else {
        navigate(`/sites/${siteId}/containers`);
      }
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if ((isEdit && containerLoading) || bootstrapLoading) {
    return (
      <div className="flex justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const domainOptions = [
    { value: '', label: '— None —' },
    ...(bootstrap?.externalDomains.map((d) => ({ value: String(d.id), label: d.name })) || []),
  ];
  const templateOptions = [
    { value: '', label: 'Select a template' },
    ...COMMON_TEMPLATES.map((t) => ({ value: t, label: t })),
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

        <Card padding="none" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className="text-base">Basics</CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
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
            {!isEdit && (
              <>
                <Select
                  label="Template"
                  value={template || ''}
                  onValueChange={(v) => setValue('template', v)}
                  options={templateOptions}
                />
                {template === 'custom' && (
                  <Input
                    label="Custom template"
                    placeholder="e.g. docker:my-org/my-image:tag"
                    {...register('customTemplate')}
                  />
                )}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      label="Or look up image metadata"
                      placeholder="docker:org/image:tag"
                      {...register('customTemplate')}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    leftIcon={<Search className="size-4" />}
                    isLoading={metadataMutation.isPending}
                    onClick={() => {
                      const img = watch('customTemplate') || template;
                      if (img && img !== 'custom') metadataMutation.mutate(img);
                    }}
                  >
                    Fetch
                  </Button>
                </div>
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
            {bootstrap?.nvidiaAvailable && (
              <Switch
                label="Request NVIDIA GPU"
                description="Schedule on a node with a GPU and pass it through"
                checked={!!nvidiaRequested}
                onCheckedChange={(c) => setValue('nvidiaRequested', c)}
              />
            )}
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
                  externalHostname: '',
                  externalDomainId: '',
                  dnsName: '',
                  authRequired: false,
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
              return (
                <div key={f.id} className="grid gap-3 rounded-lg border border-border p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Select
                      label="Type"
                      value={svc.type}
                      onValueChange={(v) =>
                        setValue(
                          `services.${idx}.type`,
                          v as FormData['services'][number]['type'],
                        )
                      }
                      options={SERVICE_TYPES}
                    />
                    <Input
                      label="Internal port"
                      type="number"
                      inputMode="numeric"
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
                        {...register(`services.${idx}.externalHostname`)}
                      />
                      <Select
                        label="External domain"
                        value={svc.externalDomainId || ''}
                        onValueChange={(v) =>
                          setValue(`services.${idx}.externalDomainId`, v)
                        }
                        options={domainOptions}
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
                  {svc.type === 'srv' && (
                    <Input
                      label="DNS name"
                      placeholder="_service._tcp.example"
                      {...register(`services.${idx}.dnsName`)}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

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
        </Card>

        {mutation.error && (
          <Alert variant="danger">
            <AlertDescription>{(mutation.error as ApiError).message}</AlertDescription>
          </Alert>
        )}
      </div>
    </form>
  );
}
