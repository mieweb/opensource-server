import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Spinner,
  usePrefersReducedMotion,
} from '@mieweb/ui';
import {
  ShieldCheck,
  Smartphone,
  AlertTriangle,
  XCircle,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react';
import { useLoginMutation, useDevLoginMutation, useServerInfo, useSession, fetchChallenge, sessionKey, type ChallengeStatus, type SessionUser } from '@/lib/auth';
import { ApiError, clearCsrfToken } from '@/lib/api';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useQueryClient } from '@tanstack/react-query';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 5 * 60 * 1000;

// A redirect target is "external" when it parses as an absolute http(s) URL.
// react-router's navigate() treats such strings as in-app paths and mangles
// them (e.g. "/login/https:/host/..."), so we must hand external targets to
// the browser via a full-page navigation instead. Only http/https schemes are
// honored to avoid javascript:/data: style injection through ?redirect=.
function asExternalUrl(target: string): string | null {
  let url: URL;
  try {
    url = new URL(target, window.location.origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Same-origin targets stay in-app (let react-router handle them as paths).
  if (url.origin === window.location.origin) return null;
  return url.href;
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const login = useLoginMutation();
  const devLogin = useDevLoginMutation();
  const { data: serverInfo } = useServerInfo();
  const isDev = !!serverInfo?.isDev;
  const { data: session, isLoading: sessionLoading } = useSession();

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeStatus | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const pollStart = useRef<number>(0);
  const approvedHandled = useRef(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // Send the user to their post-login destination. Cross-site absolute URLs
  // (e.g. ?redirect=https://test-studio...) require a real browser navigation;
  // same-origin paths are handled in-app by react-router.
  const goTo = (target: string) => {
    const external = asExternalUrl(target);
    if (external) {
      window.location.assign(external);
    } else {
      navigate(target, { replace: true });
    }
  };

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  // Already-authenticated users shouldn't see the login form: send them to
  // their intended destination (or home). Guarded by !challengeId so we don't
  // pre-empt an in-progress 2FA flow on this page.
  useEffect(() => {
    if (!sessionLoading && session && !challengeId) {
      goTo(redirect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionLoading, challengeId, redirect]);

  function startPolling(id: string) {
    pollStart.current = Date.now();
    approvedHandled.current = false;
    const poll = async () => {
      try {
        const status = await fetchChallenge(id);
        if (status.status === 'approved') {
          // The challenge is single-use: the server activates the session and
          // deletes the challenge on the first 'approved' response. Guard so a
          // second in-flight poll can't re-run this (a repeat fetch would 404
          // and surface as a spurious failure).
          if (approvedHandled.current) return;
          approvedHandled.current = true;
          // New authenticated session: drop any pre-login CSRF token so the
          // next mutation fetches one bound to it, avoiding a reactive 403.
          clearCsrfToken();
          // The server has already saved the session, so seed the cache as the
          // authoritative state. Navigate immediately — RequireAuth reads this
          // cached session and lets us through. We intentionally do NOT block
          // navigation on a refetch: a transient refetch failure/race must not
          // bounce the now-authenticated user back to the login screen.
          qc.setQueryData<SessionUser>(sessionKey, {
            user: status.user || '',
            isAdmin: !!status.isAdmin,
          });
          void qc.invalidateQueries({ queryKey: sessionKey });
          goTo(status.redirect && status.redirect !== '/' ? status.redirect : redirect);
          return;
        }
        // Only surface non-approved statuses (keeps an 'approved' status from
        // ever rendering through the error/fallback view).
        setChallenge(status);
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
        // If we've already handled approval and navigated, ignore late errors
        // from any straggling poll (e.g. a 404 for the now-deleted challenge).
        if (approvedHandled.current) return;
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
        goTo(result.redirect && result.redirect !== '/' ? result.redirect : redirect);
      } else {
        setChallengeId(result.challengeId);
        setChallenge({ status: 'pending' });
        startPolling(result.challengeId);
      }
    } catch {
      /* error handled via login.error */
    }
  });

  const onDevLogin = async (role: 'admin' | 'user') => {
    try {
      await devLogin.mutateAsync({ role });
      goTo(redirect);
    } catch {
      /* error handled via devLogin.error */
    }
  };

  const submissionError =
    login.error && login.error.status !== 401
      ? login.error.message
      : login.error?.status === 401
        ? 'Invalid username or password'
        : null;

  if (challengeId && challenge) {
    return <ChallengeStatusView status={challenge} onCancel={() => setChallengeId(null)} />;
  }

  // Avoid flashing the form while we resolve the session / redirect an
  // already-authenticated user.
  if (sessionLoading || (session && !challengeId)) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
      </div>
    );
  }

  const passwordField = register('password');

  return (
    <section aria-labelledby="signin-heading" className="flex flex-col gap-8">
      <header className="space-y-2">
        <h1
          id="signin-heading"
          className="text-2xl font-semibold tracking-tight text-[var(--mieweb-foreground,#171717)] sm:text-3xl"
        >
          Welcome back
        </h1>
        <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
          Sign in to your Container Manager account to continue.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {submissionError && (
          <Alert variant="danger">
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription>{submissionError}</AlertDescription>
          </Alert>
        )}

        <Input
          label="Username"
          autoComplete="username"
          autoFocus
          required
          error={errors.username?.message}
          hasError={!!errors.username}
          {...register('username')}
        />

        <div className="flex flex-col gap-1.5">
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            error={errors.password?.message}
            hasError={!!errors.password}
            {...passwordField}
            onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
            onKeyDown={(e) => setCapsLock(e.getModifierState('CapsLock'))}
            onBlur={(e) => {
              setCapsLock(false);
              void passwordField.onBlur(e);
            }}
          />
          {capsLock && (
            <p
              role="status"
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--mieweb-warning,#f59e0b)]"
            >
              <Lock className="size-3.5" aria-hidden="true" />
              Caps Lock is on
            </p>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-pressed={showPassword}
              className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-[var(--mieweb-muted-foreground,#64748b)] transition hover:text-[var(--mieweb-foreground,#171717)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mieweb-ring,#27aae1)] focus-visible:ring-offset-2"
            >
              {showPassword ? (
                <>
                  <EyeOff className="size-3.5" aria-hidden="true" /> Hide password
                </>
              ) : (
                <>
                  <Eye className="size-3.5" aria-hidden="true" /> Show password
                </>
              )}
            </button>
            <Link
              to="/reset-password"
              className="text-xs font-medium text-[var(--mieweb-primary-700,#1786b3)] hover:text-[var(--mieweb-primary-800,#0f749c)] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isSubmitting || login.isPending}
          fullWidth
        >
          Sign in
        </Button>

        <div className="relative py-1 text-center">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--mieweb-border,#e5e7eb)]"
          />
          <span className="relative inline-block bg-[var(--mieweb-background,#ffffff)] px-3 text-xs uppercase tracking-wider text-[var(--mieweb-muted-foreground,#64748b)]">
            New to Container Manager?
          </span>
        </div>

        <Link
          to="/register"
          className="inline-flex w-full items-center justify-center rounded-md border border-[var(--mieweb-border,#e5e7eb)] px-4 py-2.5 text-sm font-medium text-[var(--mieweb-foreground,#171717)] transition hover:bg-[var(--mieweb-muted,#f5f5f5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mieweb-ring,#27aae1)] focus-visible:ring-offset-2"
        >
          Create an account
        </Link>

        {isDev && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-[var(--mieweb-warning,#f59e0b)]/60 bg-[var(--mieweb-warning,#f59e0b)]/5 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--mieweb-warning,#f59e0b)]">
              Dev mode
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                fullWidth
                isLoading={devLogin.isPending && devLogin.variables?.role === 'admin'}
                onClick={() => onDevLogin('admin')}
              >
                Login as Admin
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                fullWidth
                isLoading={devLogin.isPending && devLogin.variables?.role === 'user'}
                onClick={() => onDevLogin('user')}
              >
                Login as User
              </Button>
            </div>
            {devLogin.error && (
              <p className="text-xs text-[var(--mieweb-destructive,#dc2626)]">
                {devLogin.error.message}
              </p>
            )}
          </div>
        )}
      </form>

      <p className="text-center text-xs text-[var(--mieweb-muted-foreground,#64748b)]">
        Protected by push-approved sign-in.{' '}
        <ShieldCheck className="-mt-0.5 inline size-3.5 text-[var(--mieweb-primary-700,#1786b3)]" />
      </p>
    </section>
  );
}

function ChallengeStatusView({
  status,
  onCancel,
}: {
  status: ChallengeStatus;
  onCancel: () => void;
}) {
  const reduceMotion = usePrefersReducedMotion();
  if (status.status === 'pending') {
    return (
      <section
        aria-labelledby="challenge-heading"
        aria-live="polite"
        className="flex flex-col items-center gap-6 text-center"
      >
        <div className="relative">
          {!reduceMotion && (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-ping rounded-full bg-[var(--mieweb-primary-200,#80d5f0)] opacity-75"
            />
          )}
          <span className="relative flex size-20 items-center justify-center rounded-full bg-[var(--mieweb-primary-50,#e6f7fc)] ring-1 ring-[var(--mieweb-primary-200,#80d5f0)]">
            <Smartphone className="size-9 text-[var(--mieweb-primary-700,#1786b3)]" />
          </span>
        </div>

        <div className="space-y-2">
          <h2
            id="challenge-heading"
            className="text-xl font-semibold text-[var(--mieweb-foreground,#171717)]"
          >
            Approve sign-in on your device
          </h2>
          <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
            We sent a push notification to your registered device. Tap{' '}
            <span className="font-medium text-[var(--mieweb-foreground,#171717)]">Approve</span> to
            finish signing in.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--mieweb-muted-foreground,#64748b)]">
          <Spinner size="sm" />
          <span>Waiting for approval&hellip;</span>
        </div>

        <Button variant="ghost" onClick={onCancel}>
          Cancel and try again
        </Button>
      </section>
    );
  }

  if (status.status === 'unregistered') {
    return (
      <section className="flex flex-col gap-5" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-[var(--mieweb-warning,#f59e0b)]/10 ring-1 ring-[var(--mieweb-warning,#f59e0b)]/30">
            <AlertTriangle className="size-6 text-[var(--mieweb-warning,#f59e0b)]" />
          </span>
          <h2 className="text-xl font-semibold text-[var(--mieweb-foreground,#171717)]">
            Device not registered
          </h2>
          <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
            No device is enrolled for push 2FA on this account. Contact an administrator to receive
            an enrollment invite.
          </p>
        </div>
        <Button variant="primary" onClick={onCancel} fullWidth>
          Back to sign in
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5" aria-live="assertive">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-[var(--mieweb-destructive,#dc2626)]/10 ring-1 ring-[var(--mieweb-destructive,#dc2626)]/30">
          <XCircle className="size-6 text-[var(--mieweb-destructive,#dc2626)]" />
        </span>
        <h2 className="text-xl font-semibold text-[var(--mieweb-foreground,#171717)]">
          Sign-in not completed
        </h2>
        <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
          {status.message || `Status: ${status.status}`}
        </p>
      </div>
      <Button variant="primary" onClick={onCancel} fullWidth>
        Try again
      </Button>
    </section>
  );
}
