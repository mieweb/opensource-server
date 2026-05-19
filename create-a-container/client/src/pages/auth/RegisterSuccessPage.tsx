import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Alert, AlertDescription, AlertTitle, Spinner } from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

interface RegisterState {
  uid?: string;
  status?: 'active' | 'pending';
  message?: string;
  enrollmentToken?: string;
  warning?: string;
}

export function RegisterSuccessPage() {
  useDocumentTitle('Account created');
  const location = useLocation();
  const state = (location.state as RegisterState | null) || {};
  const [qr, setQr] = useState<{ qrCodeDataUri: string; inviteUrl: string } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    if (!state.enrollmentToken) return;
    let cancelled = false;
    setQrLoading(true);
    (async () => {
      try {
        const data = await api.get<{ qrCodeDataUri: string; inviteUrl: string }>(
          `/api/v1/auth/register/2fa-qr/${encodeURIComponent(state.enrollmentToken!)}`,
        );
        if (!cancelled) setQr(data);
      } catch (err) {
        if (!cancelled) setQrError(err instanceof ApiError ? err.message : 'QR code unavailable');
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.enrollmentToken]);

  return (
    <div className="flex flex-col gap-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--mieweb-foreground,#171717)] sm:text-3xl">
          {state.status === 'active' ? 'Welcome aboard' : 'Almost there'}
        </h1>
        <p className="text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
          {state.message ||
            (state.status === 'active'
              ? 'Your account is ready. You can sign in.'
              : 'Your account is awaiting administrator approval.')}
        </p>
      </header>

      {state.warning && (
        <Alert variant="warning">
          <AlertTitle>Notice</AlertTitle>
          <AlertDescription>{state.warning}</AlertDescription>
        </Alert>
      )}

      {state.enrollmentToken && (
        <div className="rounded-lg border border-[var(--mieweb-border,#e5e7eb)] bg-[var(--mieweb-muted,#f5f5f5)] p-4">
          <h2 className="mb-2 text-sm font-semibold text-[var(--mieweb-foreground,#171717)]">
            Enroll your second factor
          </h2>
          <p className="mb-3 text-sm text-[var(--mieweb-muted-foreground,#64748b)]">
            Scan this QR code with the push-notification app to register your device for 2FA.
          </p>
          {qrLoading && (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          )}
          {qrError && (
            <Alert variant="danger">
              <AlertDescription>{qrError}</AlertDescription>
            </Alert>
          )}
          {qr && (
            <div className="flex flex-col items-center gap-2">
              <img
                src={qr.qrCodeDataUri}
                alt="2FA enrollment QR code"
                className="size-48 rounded-md bg-white p-2"
              />
              <a
                href={qr.inviteUrl}
                className="text-xs font-medium text-[var(--mieweb-primary-700,#1786b3)] hover:text-[var(--mieweb-primary-800,#0f749c)] hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Open enrollment link
              </a>
            </div>
          )}
        </div>
      )}

      <Link
        to="/login"
        className="text-center text-sm font-medium text-[var(--mieweb-primary-700,#1786b3)] hover:text-[var(--mieweb-primary-800,#0f749c)] hover:underline"
      >
        Continue to sign in
      </Link>
    </div>
  );
}
