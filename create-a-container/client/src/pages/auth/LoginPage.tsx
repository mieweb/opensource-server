import { useEffect, useState } from 'react';
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
} from '@mieweb/ui';
import { ShieldCheck, Eye, EyeOff, Lock } from 'lucide-react';
import { useLoginMutation, useDevLoginMutation, useServerInfo, useSession } from '@/lib/auth';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

// Human-readable messages for OIDC callback failures surfaced via ?oidc_error.
const OIDC_ERROR_MESSAGES: Record<string, string> = {
  expired: 'Your sign-in session expired before it completed. Please try again.',
  exchange_failed: 'We could not complete sign-in with your identity provider. Please try again.',
  provisioning_failed: 'Sign-in succeeded but your account could not be prepared. Contact an administrator.',
  no_account: 'No matching account was found for your identity. Contact an administrator for access.',
  missing_email: 'Your identity provider did not share an email address, which is required to sign in.',
  account_inactive: 'Your account is not active. Contact an administrator.',
};

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
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const oidcError = params.get('oidc_error');
  const login = useLoginMutation();
  const devLogin = useDevLoginMutation();
  const { data: serverInfo, isLoading: serverInfoLoading } = useServerInfo();
  const isDev = !!serverInfo?.isDev;
  const oidcEnabled = !!serverInfo?.oidcEnabled;
  const { data: session, isLoading: sessionLoading } = useSession();

  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

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

  // Already-authenticated users shouldn't see the login form: send them to
  // their intended destination (or home).
  useEffect(() => {
    if (!sessionLoading && session) {
      goTo(redirect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionLoading, redirect]);

  // When an identity provider is configured, the login screen automatically
  // redirects to it. We only auto-redirect once we know there's no active
  // session and the previous attempt didn't fail (avoids a redirect loop).
  const shouldAutoRedirectToIdp =
    oidcEnabled && !oidcError && !sessionLoading && !session;
  useEffect(() => {
    if (shouldAutoRedirectToIdp) {
      const url = `/api/v1/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`;
      window.location.assign(url);
    }
  }, [shouldAutoRedirectToIdp, redirect]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await login.mutateAsync({ ...values, redirect });
      goTo(result.redirect && result.redirect !== '/' ? result.redirect : redirect);
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

  // Avoid flashing the form while we resolve the session / server info, or
  // while we hand off to the identity provider.
  if (sessionLoading || serverInfoLoading || (session && !sessionLoading) || shouldAutoRedirectToIdp) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
      </div>
    );
  }

  // OIDC is configured but we landed back here with an error (or after a
  // failed attempt). Internal password login is disabled, so offer a retry.
  if (oidcEnabled) {
    return (
      <section aria-labelledby="signin-heading" className="flex flex-col gap-6">
        <header className="space-y-2">
          <h1
            id="signin-heading"
            className="text-2xl font-semibold tracking-tight text-[var(--mieweb-foreground,#171717)] sm:text-3xl"
          >
            Sign in
          </h1>
          <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
            This site uses single sign-on through your identity provider.
          </p>
        </header>

        {oidcError && (
          <Alert variant="danger">
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription>
              {OIDC_ERROR_MESSAGES[oidcError] || 'Sign-in could not be completed. Please try again.'}
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          onClick={() =>
            window.location.assign(
              `/api/v1/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`,
            )
          }
        >
          Continue with single sign-on
        </Button>
      </section>
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
        Secured by your organization&rsquo;s sign-in policy.{' '}
        <ShieldCheck className="-mt-0.5 inline size-3.5 text-[var(--mieweb-primary-700,#1786b3)]" />
      </p>
    </section>
  );
}
