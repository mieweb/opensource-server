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
  Switch,
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
import { keys, queries } from '@/lib/queries';
import type { AppSettings } from '@/lib/types';

const envVarSchema = z.object({
  key: z.string(),
  value: z.string(),
  description: z.string().optional(),
});

const schema = z.object({
  pushNotificationEnabled: z.boolean(),
  pushNotificationUrl: z.string(),
  pushNotificationApiKey: z.string(),
  smtpUrl: z.string(),
  smtpNoreplyAddress: z.string(),
  defaultContainerEnvVars: z.array(envVarSchema),
}).refine(
  (v) => !v.pushNotificationEnabled || v.pushNotificationUrl.trim() !== '',
  { path: ['pushNotificationUrl'], message: 'URL is required when push notifications are enabled' },
);
type FormData = z.infer<typeof schema>;

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: keys.settings(), queryFn: queries.getSettings });

  const { register, handleSubmit, reset, control, watch, setValue, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      pushNotificationEnabled: false,
      pushNotificationUrl: '',
      pushNotificationApiKey: '',
      smtpUrl: '',
      smtpNoreplyAddress: '',
      defaultContainerEnvVars: [],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'defaultContainerEnvVars' });
  const pushEnabled = watch('pushNotificationEnabled');

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormData) => api.put<AppSettings>('/api/v1/settings', values),
    onSuccess: () => {
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: keys.settings() });
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
          <h2 className="text-lg font-semibold">Push notifications</h2>
          <Switch
            label="Enable push notifications"
            checked={pushEnabled}
            onCheckedChange={(c) => setValue('pushNotificationEnabled', c)}
          />
          <Input
            label="Push notification URL"
            placeholder="https://push.example.com/notify"
            error={formState.errors.pushNotificationUrl?.message}
            hasError={!!formState.errors.pushNotificationUrl}
            {...register('pushNotificationUrl')}
          />
          <Input
            label="Push notification API key"
            type="password"
            autoComplete="off"
            {...register('pushNotificationApiKey')}
          />
        </section>

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

        {mutation.error && <Alert variant="danger"><AlertDescription>{(mutation.error as ApiError).message}</AlertDescription></Alert>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="primary" isLoading={mutation.isPending}>Save settings</Button>
        </div>
      </form>
    </div>
  );
}
