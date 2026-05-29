import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, Button, Input, useToast } from '@mieweb/ui';
import { Mail, Info } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { FormPageLayout } from '@/components/FormPageLayout';

const schema = z.object({ email: z.string().email('Must be a valid email') });
type FormData = z.infer<typeof schema>;

export function InviteUserPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { register, handleSubmit, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (v: FormData) =>
      api.post<{ email: string; message: string }>('/api/v1/users/invite', v),
    onSuccess: (r) => {
      toast.success(`Invitation sent to ${r.email}`);
      navigate('/users');
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
      <FormPageLayout
        icon={<Mail className="size-6" />}
        title="Invite user"
        subtitle="Send an email invitation to join your team."
        backTo={{ label: 'Back to users', to: '/users' }}
        aside={
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p>
              The recipient will receive a one-time link to set their password. Invitations expire
              after <span className="font-medium text-foreground">7 days</span>. Need to invite many
              at once? Script bulk invites against{' '}
              <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px]">
                POST /api/v1/users/invite
              </code>
              .
            </p>
          </div>
        }
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => navigate('/users')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={mutation.isPending}>
              Send invitation
            </Button>
          </>
        }
      >
        <Input
          label="Email"
          type="email"
          required
          placeholder="person@example.com"
          autoComplete="email"
          inputMode="email"
          error={formState.errors.email?.message}
          hasError={!!formState.errors.email}
          {...register('email')}
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
