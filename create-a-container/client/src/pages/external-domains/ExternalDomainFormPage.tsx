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
  Select,
  Spinner,
  useToast,
} from '@mieweb/ui';
import { Globe } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { FormPageLayout } from '@/components/FormPageLayout';
import type { ExternalDomain } from '@/lib/types';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  siteId: z.string().optional(),
  acmeEmail: z.string().email('Must be a valid email').or(z.literal('')).optional(),
  acmeDirectoryUrl: z.string().url('Must be a valid URL').or(z.literal('')).optional(),
  cloudflareApiEmail: z.string().email('Must be a valid email').or(z.literal('')).optional(),
  cloudflareApiKey: z.string().optional(),
  authServer: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export function ExternalDomainFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: domain, isLoading } = useQuery({
    queryKey: keys.externalDomain(id ?? 'new'),
    queryFn: () => queries.getExternalDomain(id!),
    enabled: isEdit,
  });
  const { data: sites } = useQuery({ queryKey: keys.sites(), queryFn: queries.listSites });

  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
  });
  const siteIdValue = watch('siteId');

  useEffect(() => {
    if (domain) {
      reset({
        name: domain.name,
        siteId: domain.siteId ? String(domain.siteId) : '',
        acmeEmail: domain.acmeEmail || '',
        acmeDirectoryUrl: domain.acmeDirectoryUrl || '',
        cloudflareApiEmail: domain.cloudflareApiEmail || '',
        cloudflareApiKey: '',
        authServer: domain.authServer || '',
      });
    }
  }, [domain, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormData) => {
      const payload = {
        ...values,
        siteId: values.siteId ? parseInt(values.siteId, 10) : null,
      };
      return isEdit
        ? api.put<ExternalDomain>(`/api/v1/external-domains/${id}`, payload)
        : api.post<ExternalDomain>('/api/v1/external-domains', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'External domain updated' : 'External domain created');
      qc.invalidateQueries({ queryKey: keys.externalDomains() });
      navigate('/external-domains');
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
        icon={<Globe className="size-6" />}
        title={isEdit ? 'Edit external domain' : 'New external domain'}
        subtitle={
          isEdit
            ? 'Update ACME, DNS, and authentication settings.'
            : 'Configure a public domain with ACME certificate issuance and optional Cloudflare DNS.'
        }
        backTo={{ label: 'Back to external domains', to: '/external-domains' }}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => navigate('/external-domains')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={mutation.isPending}>
              {isEdit ? 'Save changes' : 'Create domain'}
            </Button>
          </>
        }
      >
        <Input
          label="Domain"
          required
          placeholder="example.com"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={formState.errors.name?.message}
          hasError={!!formState.errors.name}
          {...register('name')}
        />
        <Select
          label="Site"
          placeholder="Select a site (optional)"
          value={siteIdValue || ''}
          onValueChange={(v) => setValue('siteId', v)}
          options={[
            { value: '', label: '— None —' },
            ...(sites?.map((s) => ({ value: String(s.id), label: s.name })) || []),
          ]}
        />
        <Input
          label="ACME email"
          type="email"
          inputMode="email"
          autoComplete="email"
          {...register('acmeEmail')}
          error={formState.errors.acmeEmail?.message}
          hasError={!!formState.errors.acmeEmail}
        />
        <Input
          label="ACME directory URL"
          placeholder="https://acme-v02.api.letsencrypt.org/directory"
          {...register('acmeDirectoryUrl')}
          error={formState.errors.acmeDirectoryUrl?.message}
          hasError={!!formState.errors.acmeDirectoryUrl}
        />
        <Input
          label="Cloudflare API email"
          type="email"
          inputMode="email"
          {...register('cloudflareApiEmail')}
          error={formState.errors.cloudflareApiEmail?.message}
          hasError={!!formState.errors.cloudflareApiEmail}
        />
        <Input
          label="Cloudflare API key"
          type="password"
          autoComplete="new-password"
          helperText={
            isEdit && domain?.hasCloudflareApiKey ? 'Leave blank to keep existing key' : undefined
          }
          {...register('cloudflareApiKey')}
        />
        <Input
          label="Auth server"
          helperText="Optional URL for nginx auth_request"
          {...register('authServer')}
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
