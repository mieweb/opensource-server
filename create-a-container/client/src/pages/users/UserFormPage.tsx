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
  Select,
  Spinner,
  useToast,
} from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { User } from '@/lib/types';

const schema = z.object({
  uid: z.string().min(1, 'Required'),
  givenName: z.string().min(1, 'Required'),
  sn: z.string().min(1, 'Required'),
  mail: z.string().email('Must be a valid email'),
  userPassword: z.string().optional(),
  status: z.enum(['pending', 'active', 'disabled']),
  groupIds: z.array(z.number()).optional(),
});
type FormData = z.infer<typeof schema>;

export function UserFormPage() {
  const { uid } = useParams<{ uid?: string }>();
  const isEdit = !!uid;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: user, isLoading } = useQuery({
    queryKey: keys.user(uid ?? 'new'),
    queryFn: () => queries.getUser(uid!),
    enabled: isEdit,
  });
  const { data: groups } = useQuery({ queryKey: keys.groups(), queryFn: queries.listGroups });

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { status: 'pending', groupIds: [] },
  });
  const status = watch('status');
  const groupIds = watch('groupIds') || [];

  useEffect(() => {
    if (user) {
      reset({
        uid: user.uid,
        givenName: user.givenName,
        sn: user.sn,
        mail: user.mail,
        userPassword: '',
        status: user.status,
        groupIds: user.groups?.map((g) => g.gidNumber) || [],
      });
    }
  }, [user, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormData) => {
      const payload: Record<string, unknown> = { ...values };
      if (!values.userPassword) delete payload.userPassword;
      return isEdit
        ? api.put<User>(`/api/v1/users/${uid}`, payload)
        : api.post<User>('/api/v1/users', payload);
    },
    onSuccess: (result) => {
      if (result.twoFactorWarning) {
        toast.warning(`User saved, but 2FA invite failed: ${result.twoFactorWarning}`);
      } else {
        toast.success(isEdit ? 'User updated' : 'User created');
      }
      qc.invalidateQueries({ queryKey: keys.users() });
      navigate('/users');
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (isEdit && isLoading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;

  function toggleGroup(gid: number) {
    const next = groupIds.includes(gid) ? groupIds.filter((g) => g !== gid) : [...groupIds, gid];
    setValue('groupIds', next);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={isEdit ? `Edit user: ${user?.uid ?? ''}` : 'New user'} bordered />
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate className="grid max-w-2xl gap-4">
        <Input label="Username" required disabled={isEdit} error={formState.errors.uid?.message} hasError={!!formState.errors.uid} {...register('uid')} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="First name" required error={formState.errors.givenName?.message} hasError={!!formState.errors.givenName} {...register('givenName')} />
          <Input label="Last name" required error={formState.errors.sn?.message} hasError={!!formState.errors.sn} {...register('sn')} />
        </div>
        <Input label="Email" type="email" required error={formState.errors.mail?.message} hasError={!!formState.errors.mail} {...register('mail')} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required={!isEdit}
          helperText={isEdit ? 'Leave blank to keep the current password' : undefined}
          {...register('userPassword')}
        />
        <Select
          label="Status"
          value={status}
          onValueChange={(v) => setValue('status', v as FormData['status'])}
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'active', label: 'Active' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Groups</legend>
          {groups?.map((g) => (
            <Checkbox
              key={g.gidNumber}
              label={g.cn + (g.isAdmin ? ' (admin)' : '')}
              checked={groupIds.includes(g.gidNumber)}
              onChange={() => toggleGroup(g.gidNumber)}
            />
          ))}
        </fieldset>

        {mutation.error && <Alert variant="danger"><AlertDescription>{(mutation.error as ApiError).message}</AlertDescription></Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/users')}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create user'}
          </Button>
        </div>
      </form>
    </div>
  );
}
