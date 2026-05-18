import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle, Button, Input, Spinner } from '@mieweb/ui';
import { useLoginMutation, fetchChallenge, type ChallengeStatus } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 5 * 60 * 1000;

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const login = useLoginMutation();

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeStatus | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollStart = useRef<number>(0);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  function startPolling(id: string) {
    pollStart.current = Date.now();
    const poll = async () => {
      try {
        const status = await fetchChallenge(id);
        setChallenge(status);
        if (status.status === 'approved') {
          navigate(status.redirect && status.redirect !== '/' ? status.redirect : redirect, {
            replace: true,
          });
          return;
        }
        if (
          status.status === 'rejected' ||
          status.status === 'timeout' ||
          status.status === 'failed' ||
          status.status === 'unregistered'
        ) {
          return;
        }
        if (Date.now() - pollStart.current > POLL_MAX_MS) {
          setChallenge({ status: 'timeout', message: 'Challenge expired' });
          return;
        }
        pollTimer.current = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        setChallenge({
          status: 'failed',
          message: err instanceof ApiError ? err.message : 'Failed to check challenge',
        });
      }
    };
    poll();
  }

  const onSubmit = handleSubmit(async (values) => {
    setChallenge(null);
    setChallengeId(null);
    try {
      const result = await login.mutateAsync({ ...values, redirect });
      if (result.kind === 'logged-in') {
        navigate(result.redirect && result.redirect !== '/' ? result.redirect : redirect, {
          replace: true,
        });
      } else {
        setChallengeId(result.challengeId);
        setChallenge({ status: 'pending' });
        startPolling(result.challengeId);
      }
    } catch {
      /* error handled via login.error */
    }
  });

  const submissionError =
    login.error && login.error.status !== 401
      ? login.error.message
      : login.error?.status === 401
        ? 'Invalid username or password'
        : null;

  if (challengeId && challenge) {
    return <ChallengeStatusView status={challenge} onCancel={() => setChallengeId(null)} />;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-(--color-muted-foreground,#64748b)">
          Use your account credentials.
        </p>
      </header>

      {submissionError && (
        <Alert variant="danger">
          <AlertTitle>Sign in failed</AlertTitle>
          <AlertDescription>{submissionError}</AlertDescription>
        </Alert>
      )}

      <Input
        label="Username"
        autoComplete="username"
        required
        error={errors.username?.message}
        hasError={!!errors.username}
        {...register('username')}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={errors.password?.message}
        hasError={!!errors.password}
        {...register('password')}
      />

      <Button type="submit" variant="primary" isLoading={isSubmitting || login.isPending} fullWidth>
        Sign in
      </Button>

      <div className="flex justify-between text-sm">
        <Link to="/reset-password" className="text-(--color-primary,#1d4ed8) hover:underline">
          Forgot password?
        </Link>
        <Link to="/register" className="text-(--color-primary,#1d4ed8) hover:underline">
          Create account
        </Link>
      </div>
    </form>
  );
}

function ChallengeStatusView({
  status,
  onCancel,
}: {
  status: ChallengeStatus;
  onCancel: () => void;
}) {
  if (status.status === 'pending') {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <Spinner size="lg" />
        <h2 className="text-lg font-semibold">Approve sign-in on your device</h2>
        <p className="text-sm text-(--color-muted-foreground,#64748b)">
          We sent a push notification to confirm this sign-in.
        </p>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  if (status.status === 'unregistered') {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          <AlertTitle>Device not registered</AlertTitle>
          <AlertDescription>
            No device is enrolled for push 2FA. Contact an administrator to receive an invite.
          </AlertDescription>
        </Alert>
        <Button variant="primary" onClick={onCancel}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="danger">
        <AlertTitle>Sign-in not completed</AlertTitle>
        <AlertDescription>{status.message || `Status: ${status.status}`}</AlertDescription>
      </Alert>
      <Button variant="primary" onClick={onCancel}>
        Try again
      </Button>
    </div>
  );
}
