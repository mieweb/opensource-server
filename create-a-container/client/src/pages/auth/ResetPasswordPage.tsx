import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle, Button, Input, Spinner } from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';

const schema = z
  .object({
    password: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type FormData = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!token) {
      setTokenError('Missing reset token');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ username: string }>(
          `/api/v1/auth/password-reset/${encodeURIComponent(token)}`,
        );
        if (!cancelled) setUsername(data.username);
      } catch (err) {
        if (!cancelled)
          setTokenError(err instanceof ApiError ? err.message : 'Invalid or expired reset link');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await api.post(`/api/v1/auth/password-reset/${encodeURIComponent(token!)}`, values);
      navigate('/login', { replace: true });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not reset password');
    }
  });

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Spinner size="lg" />
      </div>
    );
  }
  if (tokenError) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="danger">
          <AlertTitle>Reset link invalid</AlertTitle>
          <AlertDescription>{tokenError}</AlertDescription>
        </Alert>
        <Link
          to="/reset-password"
          className="text-center text-sm text-(--color-primary,#1d4ed8) hover:underline"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">Set a new password</h1>
        {username && (
          <p className="mt-1 text-sm text-(--color-muted-foreground,#64748b)">
            For account <strong>{username}</strong>
          </p>
        )}
      </header>
      {submitError && (
        <Alert variant="danger">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
      <Input
        label="New password"
        type="password"
        required
        autoComplete="new-password"
        error={errors.password?.message}
        hasError={!!errors.password}
        {...register('password')}
      />
      <Input
        label="Confirm new password"
        type="password"
        required
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        hasError={!!errors.confirmPassword}
        {...register('confirmPassword')}
      />
      <Button type="submit" variant="primary" isLoading={isSubmitting} fullWidth>
        Reset password
      </Button>
    </form>
  );
}
