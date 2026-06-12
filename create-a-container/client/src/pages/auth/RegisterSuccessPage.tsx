import { Link, useLocation } from 'react-router';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

interface RegisterState {
  uid?: string;
  status?: 'active' | 'pending';
  message?: string;
}

export function RegisterSuccessPage() {
  useDocumentTitle('Account created');
  const location = useLocation();
  const state = (location.state as RegisterState | null) || {};

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

      <Link
        to="/login"
        className="text-center text-sm font-medium text-[var(--mieweb-primary-700,#1786b3)] hover:text-[var(--mieweb-primary-800,#0f749c)] hover:underline"
      >
        Continue to sign in
      </Link>
    </div>
  );
}
