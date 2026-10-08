import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@mieweb/ui';
import { Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { serverInfoKey } from '@/lib/auth';
import { keys, queries } from '@/lib/queries';
import type { AppSettings } from '@/lib/types';

const envVarSchema = z.object({
  key: z.string(),
  value: z.string(),
  description: z.string().optional(),
});

const schema = z.object({
  smtpUrl: z.string(),
  smtpNoreplyAddress: z.string(),
  defaultContainerEnvVars: z.array(envVarSchema),
  netboxUrl: z.string(),
  netboxToken: z.string(),
  bannerMessage: z.string(),
  usagePsiProbeLimit: z.string().regex(/^\d*$/, 'Must be a non-negative whole number'),
  mailHostname: z.string(),
  mailUnsubscribeBaseUrl: z.string(),
  mailRelayhost: z.string(),
  mailRelayhostUsername: z.string(),
  mailRelayhostPassword: z.string(),
  mailSpfInclude: z.string(),
  mailDnsCheckResolvers: z.string(),
  mailDbHost: z.string(),
  mailSelfManagedSiteId: z.string().regex(/^\d*$/, 'Must be a site id'),
  mailDefaultQuotaMb: z.string().regex(/^\d*$/, 'Must be a whole number of MB'),
  mailMessageSizeLimitMb: z.string().regex(/^\d*$/, 'Must be a whole number of MB'),
}).refine((v) => !v.mailRelayhost.trim() || !!v.mailSpfInclude.trim(), {
  path: ['mailSpfInclude'],
  message: 'Required when a relayhost is set — SPF must delegate to the relay',
});
type FormData = z.infer<typeof schema>;

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: keys.settings(), queryFn: queries.getSettings });

  const { register, handleSubmit, reset, control, formState, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      smtpUrl: '',
      smtpNoreplyAddress: '',
      defaultContainerEnvVars: [],
      netboxUrl: '',
      netboxToken: '',
      bannerMessage: '',
      usagePsiProbeLimit: '',
      mailHostname: '',
      mailUnsubscribeBaseUrl: '',
      mailRelayhost: '',
      mailRelayhostUsername: '',
      mailRelayhostPassword: '',
      mailSpfInclude: '',
      mailDnsCheckResolvers: '',
      mailDbHost: '',
      mailSelfManagedSiteId: '',
      mailDefaultQuotaMb: '',
      mailMessageSizeLimitMb: '',
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'defaultContainerEnvVars' });

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormData) => api.put<AppSettings>('/api/v1/settings', values),
    onSuccess: () => {
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: keys.settings() });
      // The banner is served via /api/v1/health (cached forever by
      // useServerInfo), so refetch it for the change to show without a reload.
      qc.invalidateQueries({ queryKey: serverInfoKey });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  // Suggest the forward-confirmed PTR of the mail IP as mail_hostname.
  const suggestPtr = useMutation({
    mutationFn: queries.getMailPtr,
    onSuccess: (ptr) => {
      if (ptr.suggestion) {
        setValue('mailHostname', ptr.suggestion, { shouldDirty: true });
        toast.success(`Suggested ${ptr.suggestion} from the PTR of ${ptr.mailIp}`);
      } else if (!ptr.mailIp) {
        toast.error('No mail IP yet — no agent holds the mail-host claim');
      } else {
        toast.error(`No forward-confirmed PTR for ${ptr.mailIp}${ptr.ptr ? ` (found ${ptr.ptr})` : ''}`);
      }
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (isLoading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error) return <Alert variant="danger"><AlertDescription>{(error as ApiError).message}</AlertDescription></Alert>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" icon={<SettingsIcon className="size-6" />} bordered />
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="grid w-full gap-8">
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">SMTP</h2>
          <Input
            label="SMTP URL"
            placeholder="smtps://user:pass@smtp.example.com:465"
            helperText="Used for invitation and password reset emails"
            {...register('smtpUrl')}
          />
          <Input label="Noreply address" type="email" placeholder="noreply@example.com" {...register('smtpNoreplyAddress')} />
        </section>

        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Mail service</h2>
          <div className="flex items-end gap-2">
            <div className="grow">
              <Input
                label="Mail hostname"
                placeholder="mail.example.com"
                helperText="HELO name and MX target — should match the forward-confirmed PTR of the mail IP"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                {...register('mailHostname')}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              isLoading={suggestPtr.isPending}
              onClick={() => suggestPtr.mutate()}
            >
              Suggest from PTR
            </Button>
          </div>
          <Input
            label="Unsubscribe base URL"
            placeholder="https://manager.example.com"
            helperText="Public URL of this manager — one-click unsubscribe links point here"
            {...register('mailUnsubscribeBaseUrl')}
          />
          <Input
            label="Relayhost"
            placeholder="[smtp.relay.example]:587"
            helperText="Optional smarthost for outbound mail; leave empty to deliver directly"
            {...register('mailRelayhost')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Relayhost username" autoComplete="off" {...register('mailRelayhostUsername')} />
            <Input label="Relayhost password" type="password" autoComplete="new-password" {...register('mailRelayhostPassword')} />
          </div>
          <Input
            label="SPF include"
            placeholder="_spf.relay.example"
            helperText="Added to the suggested SPF records; required with a relayhost"
            error={formState.errors.mailSpfInclude?.message}
            hasError={!!formState.errors.mailSpfInclude}
            {...register('mailSpfInclude')}
          />
          <Input
            label="DNS check resolvers"
            placeholder="1.1.1.1, 8.8.8.8"
            helperText="Comma-separated resolver IPs used by Check DNS; empty uses the defaults"
            {...register('mailDnsCheckResolvers')}
          />
          <Input
            label="Mail DB host"
            placeholder="db.internal.example"
            helperText="Only when the mail host cannot reach the database over the local socket"
            {...register('mailDbHost')}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Self-managed site id"
              inputMode="numeric"
              helperText="Site whose external IP sends mail when no agent runs the mail group"
              error={formState.errors.mailSelfManagedSiteId?.message}
              hasError={!!formState.errors.mailSelfManagedSiteId}
              {...register('mailSelfManagedSiteId')}
            />
            <Input
              label="Default quota (MB)"
              inputMode="numeric"
              placeholder="1024"
              error={formState.errors.mailDefaultQuotaMb?.message}
              hasError={!!formState.errors.mailDefaultQuotaMb}
              {...register('mailDefaultQuotaMb')}
            />
            <Input
              label="Message size limit (MB)"
              inputMode="numeric"
              placeholder="25"
              error={formState.errors.mailMessageSizeLimitMb?.message}
              hasError={!!formState.errors.mailMessageSizeLimitMb}
              {...register('mailMessageSizeLimitMb')}
            />
          </div>
        </section>

        <section className="grid gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Default container environment variables</h2>
            <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="size-4" />} onClick={() => append({ key: '', value: '', description: '' })}>
              Add variable
            </Button>
          </div>
          {fields.length === 0 && <p className="text-sm text-(--color-muted,#6b7280)">No defaults defined.</p>}
          {fields.length > 0 && (
            <Table responsive>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/4">Key</TableHead>
                  <TableHead className="w-1/4">Value</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-px text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f, idx) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Input label="Key" hideLabel placeholder="KEY" autoCapitalize="characters" autoCorrect="off" spellCheck={false} {...register(`defaultContainerEnvVars.${idx}.key`)} />
                    </TableCell>
                    <TableCell>
                      <Input label="Value" hideLabel placeholder="value" autoCorrect="off" spellCheck={false} {...register(`defaultContainerEnvVars.${idx}.value`)} />
                    </TableCell>
                    <TableCell>
                      <Input label="Description" hideLabel placeholder="optional" {...register(`defaultContainerEnvVars.${idx}.description`)} />
                    </TableCell>
                    <TableCell className="text-right align-middle">
                      <Button type="button" variant="ghost" size="sm" leftIcon={<Trash2 className="size-4" />} onClick={() => remove(idx)} aria-label="Remove variable">
                        <span className="sr-only">Remove</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Announcement banner</h2>
          <Input
            label="Banner message"
            placeholder="Try [My New App](https://app.example.com)."
            helperText="Shown to all users at the top of the app. Link syntax: [text](url). Leave empty to hide the banner."
            autoCorrect="off"
            {...register('bannerMessage')}
          />
        </section>

        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">NetBox</h2>
          <Input
            label="NetBox URL"
            placeholder="https://netbox.example.com"
            helperText="Base URL of your NetBox instance"
            {...register('netboxUrl')}
          />
          <Input
            label="NetBox API token"
            type="password"
            autoComplete="off"
            helperText="API token with write access to IPAM and Virtualization"
            {...register('netboxToken')}
          />
        </section>

        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Usage report</h2>
          <Input
            label="PSI probe limit"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="16"
            helperText="Pressure-stall (PSI) probes per usage report — one extra Proxmox call each, spent on the highest-utilization running containers. 0 disables PSI; leave empty for the default (16)."
            error={formState.errors.usagePsiProbeLimit?.message}
            hasError={!!formState.errors.usagePsiProbeLimit}
            {...register('usagePsiProbeLimit')}
          />
        </section>

        {mutation.isSuccess && (
          <Alert variant="success" role="status" aria-live="polite">
            <AlertDescription>Your settings have been saved successfully.</AlertDescription>
          </Alert>
        )}
        {mutation.error && <Alert variant="danger"><AlertDescription>{(mutation.error as ApiError).message}</AlertDescription></Alert>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="primary" isLoading={mutation.isPending}>Save settings</Button>
        </div>
      </form>
    </div>
  );
}
