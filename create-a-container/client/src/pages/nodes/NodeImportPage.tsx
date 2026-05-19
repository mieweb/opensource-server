import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, Button, Input, Switch, useToast } from '@mieweb/ui';
import { Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';
import { FormPageLayout } from '@/components/FormPageLayout';

const schema = z.object({
  apiUrl: z.string().url('Must be a valid URL'),
  username: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
  tlsVerify: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export function NodeImportPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { register, handleSubmit, watch, setValue, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { tlsVerify: true },
  });
  const tlsVerify = watch('tlsVerify');

  const mutation = useMutation({
    mutationFn: (values: FormData) =>
      api.post<{ imported: number }>(`/api/v1/sites/${siteId}/nodes/import-proxmox`, values),
    onSuccess: (result) => {
      toast.success(`Imported ${result.imported} node(s)`);
      qc.invalidateQueries({ queryKey: keys.nodes(siteId!) });
      navigate(`/sites/${siteId}/nodes`);
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
      <FormPageLayout
        icon={<Download className="size-6" />}
        title="Import nodes from Proxmox"
        subtitle="Bulk import from a Proxmox cluster"
        description="Sign in to a Proxmox cluster and import every node along with its existing LXC containers into this site."
        backTo={{ label: 'Back to nodes', to: `/sites/${siteId}/nodes` }}
        maxWidth="xl"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(`/sites/${siteId}/nodes`)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={mutation.isPending}>
              Import
            </Button>
          </>
        }
      >
        <Input
          label="Proxmox API URL"
          type="url"
          required
          placeholder="https://pve.example.com:8006"
          error={formState.errors.apiUrl?.message}
          hasError={!!formState.errors.apiUrl}
          {...register('apiUrl')}
        />
        <Input
          label="Username"
          required
          placeholder="root@pam"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          error={formState.errors.username?.message}
          hasError={!!formState.errors.username}
          {...register('username')}
        />
        <Input
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          error={formState.errors.password?.message}
          hasError={!!formState.errors.password}
          {...register('password')}
        />
        <Switch
          label="Verify TLS certificate"
          checked={tlsVerify ?? true}
          onCheckedChange={(c) => setValue('tlsVerify', c)}
        />
        {mutation.error && (
          <Alert variant="danger">
            <AlertDescription>{(mutation.error as ApiError).message}</AlertDescription>
          </Alert>
        )}
      </FormPageLayout>
    </form>
  );
}
