import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  PageHeader,
  Switch,
  useToast,
} from '@mieweb/ui';
import { Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { Node } from '@/lib/types';

const schema = z.object({
  apiUrl: z.string().url('Must be a valid URL'),
  username: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
  tlsVerify: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

interface ImportResult {
  nodes: Node[];
  importedContainerCount: number;
}

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
    mutationFn: (v: FormData) => api.post<ImportResult>(`/api/v1/sites/${siteId}/nodes/import`, v),
    onSuccess: (r) => {
      toast.success(`Imported ${r.nodes.length} node(s) and ${r.importedContainerCount} container(s)`);
      qc.invalidateQueries({ queryKey: keys.nodes(siteId!) });
      qc.invalidateQueries({ queryKey: keys.containers(siteId!) });
      navigate(`/sites/${siteId}/nodes`);
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Import nodes from Proxmox" icon={<Download className="size-6" />} bordered />
      <Alert variant="info">
        <AlertTitle>Bulk import</AlertTitle>
        <AlertDescription>
          Sign in to a Proxmox cluster and import every node along with its existing LXC containers into this site.
        </AlertDescription>
      </Alert>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate className="grid max-w-xl gap-4">
        <Input label="Proxmox API URL" type="url" required placeholder="https://pve.example.com:8006" error={formState.errors.apiUrl?.message} hasError={!!formState.errors.apiUrl} {...register('apiUrl')} />
        <Input label="API token ID / username" required placeholder="root@pam!token-name" error={formState.errors.username?.message} hasError={!!formState.errors.username} {...register('username')} />
        <Input label="API token secret / password" type="password" required autoComplete="new-password" error={formState.errors.password?.message} hasError={!!formState.errors.password} {...register('password')} />
        <Switch label="Verify TLS certificate" checked={tlsVerify ?? true} onCheckedChange={(c) => setValue('tlsVerify', c)} />

        {mutation.error && <Alert variant="danger"><AlertDescription>{(mutation.error as ApiError).message}</AlertDescription></Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(`/sites/${siteId}/nodes`)}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={mutation.isPending}>Import</Button>
        </div>
      </form>
    </div>
  );
}
