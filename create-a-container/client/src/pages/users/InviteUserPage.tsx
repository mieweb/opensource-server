import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  PageHeader,
  useToast,
} from '@mieweb/ui';
import { Mail } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

const schema = z.object({ email: z.string().email('Must be a valid email') });
type FormData = z.infer<typeof schema>;

export function InviteUserPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { register, handleSubmit, formState } = useForm<FormData>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (v: FormData) => api.post<{ email: string; message: string }>('/api/v1/users/invite', v),
    onSuccess: (r) => {
      toast.success(`Invitation sent to ${r.email}`);
      navigate('/users');
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invite user" subtitle="Send an email invitation" icon={<Mail className="size-6" />} bordered />
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate className="grid max-w-md gap-4">
        <Input
          label="Email"
          type="email"
          required
          error={formState.errors.email?.message}
          hasError={!!formState.errors.email}
          {...register('email')}
        />
        {mutation.error && <Alert variant="danger"><AlertDescription>{(mutation.error as ApiError).message}</AlertDescription></Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/users')}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={mutation.isPending}>Send invitation</Button>
        </div>
      </form>
    </div>
  );
}
