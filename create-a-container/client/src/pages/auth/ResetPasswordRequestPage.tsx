import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle, Button, Input } from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';

const schema = z.object({
  usernameOrEmail: z.string().min(1, 'Required'),
});
type FormData = z.infer<typeof schema>;

export function ResetPasswordRequestPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/api/v1/auth/password-reset/request', values);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    }
  });

  if (submitted) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>
            If the account exists, we sent password reset instructions.
          </AlertDescription>
        </Alert>
        <Link
          to="/login"
          className="text-center text-sm text-(--color-primary,#1d4ed8) hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">Reset password</h1>
        <p className="mt-1 text-sm text-(--color-muted-foreground,#64748b)">
          Enter your username or email and we'll send a reset link.
        </p>
      </header>
      {error && (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Input
        label="Username or email"
        required
        autoComplete="username"
        error={errors.usernameOrEmail?.message}
        hasError={!!errors.usernameOrEmail}
        {...register('usernameOrEmail')}
      />
      <Button type="submit" variant="primary" isLoading={isSubmitting} fullWidth>
        Send reset link
      </Button>
      <Link
        to="/login"
        className="text-center text-sm text-(--color-primary,#1d4ed8) hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
