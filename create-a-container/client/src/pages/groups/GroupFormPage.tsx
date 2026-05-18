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
  Checkbox,
  Input,
  PageHeader,
  Spinner,
  useToast,
} from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { Group } from '@/lib/types';

const schema = z.object({
  gidNumber: z.string().min(1, 'Required').regex(/^\d+$/, 'Must be a positive integer'),
  cn: z.string().min(1, 'Required'),
  isAdmin: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export function GroupFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: group, isLoading } = useQuery({
    queryKey: keys.group(id ?? 'new'),
    queryFn: () => queries.getGroup(id!),
    enabled: isEdit,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { isAdmin: false },
  });

  useEffect(() => {
    if (group) {
      reset({ gidNumber: String(group.gidNumber), cn: group.cn, isAdmin: group.isAdmin });
    }
  }, [group, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormData) => {
      const payload = { ...values, gidNumber: parseInt(values.gidNumber, 10) };
      return isEdit
        ? api.put<Group>(`/api/v1/groups/${id}`, payload)
        : api.post<Group>('/api/v1/groups', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Group updated' : 'Group created');
      qc.invalidateQueries({ queryKey: keys.groups() });
      navigate('/groups');
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (isEdit && isLoading) {
    return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={isEdit ? 'Edit group' : 'New group'} bordered />
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate className="grid max-w-md gap-4">
        <Input
          label="GID number"
          required
          disabled={isEdit}
          error={formState.errors.gidNumber?.message}
          hasError={!!formState.errors.gidNumber}
          {...register('gidNumber')}
        />
        <Input
          label="Common name"
          required
          error={formState.errors.cn?.message}
          hasError={!!formState.errors.cn}
          {...register('cn')}
        />
        <Checkbox label="Administrator group" description="Members receive admin privileges" {...register('isAdmin')} />
        {mutation.error && <Alert variant="danger"><AlertDescription>{(mutation.error as ApiError).message}</AlertDescription></Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/groups')}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create group'}
          </Button>
        </div>
      </form>
    </div>
  );
}
