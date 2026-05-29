import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '@mieweb/ui';
import { useSession } from '@/lib/auth';
import { setOnUnauthorized } from '@/lib/api';

/**
 * Guards authenticated routes. Redirects to /login with the originating
 * path stored on history state so the login flow can return the user.
 */
export function RequireAuth() {
  const { data: session, isLoading, isError } = useSession();
  const location = useLocation();
  const [unauthorizedTrigger, setUnauthorizedTrigger] = useState(0);

  useEffect(() => {
    setOnUnauthorized(() => setUnauthorizedTrigger((n) => n + 1));
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!session || isError || unauthorizedTrigger > 0) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }

  return <Outlet />;
}
