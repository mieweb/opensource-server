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
  Select,
  Spinner,
  useToast,
} from '@mieweb/ui';
import { UserCog } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import { FormPageLayout } from '@/components/FormPageLayout';
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
    onSuccess: () => {
      toast.success(isEdit ? 'User updated' : 'User created');
      qc.invalidateQueries({ queryKey: keys.users() });
      navigate('/users');
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

  function toggleGroup(gid: number) {
    const next = groupIds.includes(gid) ? groupIds.filter((g) => g !== gid) : [...groupIds, gid];
    setValue('groupIds', next);
  }

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
      <FormPageLayout
        icon={<UserCog className="size-6" />}
        title={isEdit ? `Edit user: ${user?.uid ?? ''}` : 'New user'}
        subtitle={
          isEdit
            ? 'Update profile details, password, status, and group memberships.'
            : 'Provision a new account directly without sending an invitation.'
        }
        backTo={{ label: 'Back to users', to: '/users' }}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => navigate('/users')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={mutation.isPending}>
              {isEdit ? 'Save changes' : 'Create user'}
            </Button>
          </>
        }
      >
        <Input
          label="Username"
          required
          disabled={isEdit}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={formState.errors.uid?.message}
          hasError={!!formState.errors.uid}
          {...register('uid')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            required
            autoComplete="given-name"
            error={formState.errors.givenName?.message}
            hasError={!!formState.errors.givenName}
            {...register('givenName')}
          />
          <Input
            label="Last name"
            required
            autoComplete="family-name"
            error={formState.errors.sn?.message}
            hasError={!!formState.errors.sn}
            {...register('sn')}
          />
        </div>
        <Input
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          error={formState.errors.mail?.message}
          hasError={!!formState.errors.mail}
          {...register('mail')}
        />
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
          <legend className="text-sm font-medium text-foreground">Groups</legend>
          {groups && groups.length > 0 ? (
            groups.map((g) => (
              <Checkbox
                key={g.gidNumber}
                label={g.cn + (g.isAdmin ? ' (admin)' : '')}
                checked={groupIds.includes(g.gidNumber)}
                onChange={() => toggleGroup(g.gidNumber)}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No groups available.</p>
          )}
        </fieldset>
        {mutation.error && (
          <Alert variant="danger">
            <AlertDescription>{(mutation.error as ApiError).message}</AlertDescription>
          </Alert>
        )}
      </FormPageLayout>
    </form>
  );
}
