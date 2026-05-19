import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle, Button, Input } from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const schema = z.object({
  usernameOrEmail: z.string().min(1, 'Required'),
});
type FormData = z.infer<typeof schema>;

export function ResetPasswordRequestPage() {
  useDocumentTitle('Reset password');
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
      <div className="flex flex-col gap-5">
        <Alert variant="success">
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>
            If the account exists, we sent password reset instructions.
          </AlertDescription>
        </Alert>
        <Link
          to="/login"
          className="text-center text-sm font-medium text-[var(--mieweb-primary-700,#1786b3)] hover:text-[var(--mieweb-primary-800,#0f749c)] hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--mieweb-foreground,#171717)] sm:text-3xl">
          Reset password
        </h1>
        <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
          Enter your username or email and we&rsquo;ll send a reset link.
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
      <Button type="submit" variant="primary" size="lg" isLoading={isSubmitting} fullWidth>
        Send reset link
      </Button>
      <Link
        to="/login"
        className="text-center text-sm font-medium text-[var(--mieweb-primary-700,#1786b3)] hover:text-[var(--mieweb-primary-800,#0f749c)] hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
