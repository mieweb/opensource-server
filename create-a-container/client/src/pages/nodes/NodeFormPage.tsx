import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Spinner,
  Switch,
  useToast,
} from '@mieweb/ui';
import { Server } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { FormPageLayout } from '@/components/FormPageLayout';
import type { Node } from '@/lib/types';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  nodeType: z.enum(['proxmox', 'dummy', 'docker']).default('proxmox'),
  ipv4Address: z.string().optional(),
  apiUrl: z.string().optional(),
  tokenId: z.string().optional(),
  secret: z.string().optional(),
  tlsVerify: z.boolean().optional(),
  imageStorage: z.string().min(1, 'Required'),
  volumeStorage: z.string().min(1, 'Required'),
  networkBridge: z.string().min(1, 'Required'),
  nvidiaAvailable: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export function NodeFormPage() {
  const { siteId, id } = useParams<{ siteId: string; id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: node, isLoading } = useQuery({
    queryKey: keys.node(siteId!, id ?? 'new'),
    queryFn: () => queries.getNode(siteId!, id!),
    enabled: isEdit,
  });

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      nodeType: 'proxmox',
      ipv4Address: '',
      apiUrl: '',
      tlsVerify: true,
      nvidiaAvailable: false,
      imageStorage: 'local',
      volumeStorage: 'local-lvm',
      networkBridge: 'vmbr0',
    },
  });
  const tlsVerify = watch('tlsVerify');
  const nvidiaAvailable = watch('nvidiaAvailable');
  const nodeType = watch('nodeType');

  useEffect(() => {
    if (node) {
      reset({
        name: node.name,
        nodeType: node.nodeType || 'proxmox',
        ipv4Address: node.ipv4Address || '',
        apiUrl: node.apiUrl || '',
        tokenId: node.tokenId || '',
        secret: '',
        tlsVerify: node.tlsVerify ?? true,
        imageStorage: node.imageStorage,
        volumeStorage: node.volumeStorage,
        networkBridge: node.networkBridge,
        nvidiaAvailable: node.nvidiaAvailable,
      });
    }
  }, [node, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormData) => {
      const payload = { ...values };
      if (isEdit && !values.secret) delete payload.secret;
      return isEdit
        ? api.put<Node>(`/api/v1/sites/${siteId}/nodes/${id}`, payload)
        : api.post<Node>(`/api/v1/sites/${siteId}/nodes`, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Node updated' : 'Node created');
      qc.invalidateQueries({ queryKey: keys.nodes(siteId!) });
      navigate(`/sites/${siteId}/nodes`);
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (isEdit && isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
      <FormPageLayout
        icon={<Server className="size-6" />}
        title={isEdit ? 'Edit node' : 'New node'}
        subtitle={
          isEdit
            ? 'Update node connection details and storage settings.'
            : 'Register a node with connection details and default storage.'
        }
        backTo={{ label: 'Back to nodes', to: `/sites/${siteId}/nodes` }}
        maxWidth="3xl"
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
              {isEdit ? 'Save changes' : 'Create node'}
            </Button>
          </>
        }
      >
        <Input
          label="Name"
          required
          placeholder="pve-01"
          error={formState.errors.name?.message}
          hasError={!!formState.errors.name}
          {...register('name')}
        />
        <div className="grid gap-2">
          <label className="text-sm font-medium">Node type</label>
          <select className="border rounded-md px-3 py-2" {...register('nodeType')}>
            <option value="proxmox">Proxmox</option>
            <option value="docker">Docker</option>
            <option value="dummy">Dummy</option>
          </select>
        </div>
        <Input
          label="IPv4 address"
          placeholder="10.0.0.1"
          inputMode="numeric"
          autoComplete="off"
          {...register('ipv4Address')}
        />
        <Input
          label={nodeType === 'docker' ? 'Docker host' : 'Proxmox API URL'}
          placeholder={
            nodeType === 'docker'
              ? 'unix:///var/run/docker.sock'
              : 'https://pve.example.com:8006'
          }
          error={formState.errors.apiUrl?.message}
          hasError={!!formState.errors.apiUrl}
          {...register('apiUrl')}
        />
        {nodeType === 'proxmox' && (
          <>
            <Input
              label="API token ID"
              placeholder="root@pam!my-token"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...register('tokenId')}
            />
            <Input
              label="API token secret"
              type="password"
              autoComplete="new-password"
              helperText={isEdit && node?.hasSecret ? 'Leave blank to keep existing secret' : undefined}
              {...register('secret')}
            />
            <Switch
              label="Verify TLS certificate"
              checked={tlsVerify ?? true}
              onCheckedChange={(c) => setValue('tlsVerify', c)}
            />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Image storage" required {...register('imageStorage')} />
          <Input label="Volume storage" required {...register('volumeStorage')} />
          <Input label="Network bridge" required {...register('networkBridge')} />
        </div>
        <Switch
          label="NVIDIA available"
          description="GPU passthrough is supported on this node"
          checked={nvidiaAvailable ?? false}
          onCheckedChange={(c) => setValue('nvidiaAvailable', c)}
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
