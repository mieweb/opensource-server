import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle, Button, Input, Spinner } from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const schema = z
  .object({
    uid: z.string().min(2, 'Username must be at least 2 characters').max(32),
    givenName: z.string().min(1, 'First name is required'),
    sn: z.string().min(1, 'Last name is required'),
    mail: z.string().email('Valid email required'),
    userPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.userPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

interface InviteData {
  email: string;
}
interface RegisterResponse {
  uid: string;
  status: 'active' | 'pending';
  message: string;
}

export function RegisterPage() {
  useDocumentTitle('Create account');
  const navigate = useNavigate();
  // The invite token may arrive as a path param (/register/invite/:token) or as
  // a query string (/register?token=...), which is what invite emails use.
  const { token: pathToken } = useParams<{ token?: string }>();
  const [searchParams] = useSearchParams();
  const token = pathToken ?? searchParams.get('token') ?? undefined;
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(!!token);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormData>({ resolver: zodResolver(schema) });
  const { register, handleSubmit, formState, reset } = form;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<InviteData>(
          `/api/v1/auth/register/invite/${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        setInvite(data);
        reset({ mail: data.email } as Partial<FormData>);
      } catch (err) {
        if (cancelled) return;
        setInviteError(err instanceof ApiError ? err.message : 'Invitation invalid');
      } finally {
        if (!cancelled) setInviteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const { confirmPassword: _confirm, ...payload } = values;
      void _confirm;
      const res = await api.post<RegisterResponse>('/api/v1/auth/register', {
        ...payload,
        inviteToken: token,
      });
      navigate('/register/success', {
        state: {
          uid: res.uid,
          status: res.status,
          message: res.message,
        },
      });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Registration failed');
    }
  });

  if (inviteLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
      </div>
    );
  }
  if (token && inviteError) {
    return (
      <Alert variant="danger">
        <AlertTitle>Invitation invalid</AlertTitle>
        <AlertDescription>{inviteError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--mieweb-foreground,#171717)] sm:text-3xl">
          Create your account
        </h1>
        {invite && (
          <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
            Invitation for <strong>{invite.email}</strong>
          </p>
        )}
      </header>

      {submitError && (
        <Alert variant="danger">
          <AlertTitle>Could not register</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <Input
        label="Username"
        required
        autoComplete="username"
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
        required
        autoComplete="email"
        readOnly={!!invite}
        disabled={!!invite}
        error={formState.errors.mail?.message}
        hasError={!!formState.errors.mail}
        {...register('mail')}
      />
      <Input
        label="Password"
        type="password"
        required
        autoComplete="new-password"
        error={formState.errors.userPassword?.message}
        hasError={!!formState.errors.userPassword}
        {...register('userPassword')}
      />
      <Input
        label="Confirm password"
        type="password"
        required
        autoComplete="new-password"
        error={formState.errors.confirmPassword?.message}
        hasError={!!formState.errors.confirmPassword}
        {...register('confirmPassword')}
      />

      <Button type="submit" variant="primary" size="lg" isLoading={formState.isSubmitting} fullWidth>
        Create account
      </Button>

      <p className="text-center text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
        Already have an account?{' '}
        <Link
          to="/login"
          className="font-medium text-[var(--mieweb-primary-700,#1786b3)] hover:text-[var(--mieweb-primary-800,#0f749c)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
