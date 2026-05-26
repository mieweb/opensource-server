import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, Button, Input, Spinner, useToast } from '@mieweb/ui';
import { Building2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { FormPageLayout } from '@/components/FormPageLayout';
import type { Site } from '@/lib/types';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  internalDomain: z.string().min(1, 'Required'),
  dhcpRange: z.string().optional().nullable(),
  subnetMask: z.string().optional().nullable(),
  gateway: z.string().optional().nullable(),
  dnsForwarders: z.string().optional().nullable(),
  externalIp: z.string().optional().nullable(),
});
type FormData = z.infer<typeof schema>;

export function SiteFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: site, isLoading } = useQuery({
    queryKey: keys.site(id ?? 'new'),
    queryFn: () => queries.getSite(id!),
    enabled: isEdit,
  });

  const form = useForm<FormData>({ resolver: zodResolver(schema) });
  const { register, handleSubmit, reset, formState } = form;

  useEffect(() => {
    if (site) reset(site as FormData);
  }, [site, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormData) =>
      isEdit
        ? api.put<Site>(`/api/v1/sites/${id}`, values)
        : api.post<Site>('/api/v1/sites', values),
    onSuccess: (saved) => {
      toast.success(isEdit ? 'Site updated' : 'Site created');
      qc.invalidateQueries({ queryKey: keys.sites() });
      navigate(`/sites/${saved.id}/containers`);
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
        icon={<Building2 className="size-6" />}
        title={isEdit ? 'Edit site' : 'New site'}
        subtitle={
          isEdit
            ? 'Update networking and DNS settings for this site.'
            : 'Define a new site with its internal network, DHCP, and DNS.'
        }
        backTo={{ label: 'Back to sites', to: '/sites' }}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => navigate('/sites')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={mutation.isPending}>
              {isEdit ? 'Save changes' : 'Create site'}
            </Button>
          </>
        }
      >
        <Input
          label="Name"
          required
          placeholder="Production"
          error={formState.errors.name?.message}
          hasError={!!formState.errors.name}
          {...register('name')}
        />
        <Input
          label="Internal domain"
          helperText="Used for DNS inside the site, e.g. mie.lan"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={formState.errors.internalDomain?.message}
          hasError={!!formState.errors.internalDomain}
          {...register('internalDomain')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="DHCP range"
            helperText="Comma-separated start,end (rendered into dnsmasq)"
            placeholder="10.0.0.100,10.0.0.200"
            {...register('dhcpRange')}
          />
          <Input
            label="Subnet mask"
            placeholder="255.255.255.0"
            inputMode="numeric"
            {...register('subnetMask')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Gateway"
            placeholder="10.0.0.1"
            inputMode="numeric"
            {...register('gateway')}
          />
          <Input
            label="DNS forwarders"
            helperText="Comma-separated upstream resolvers (rendered into dnsmasq)"
            placeholder="8.8.8.8,1.1.1.1"
            {...register('dnsForwarders')}
          />
        </div>
        <Input
          label="External IP"
          placeholder="Public IP for this site"
          inputMode="numeric"
          autoComplete="off"
          {...register('externalIp')}
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
