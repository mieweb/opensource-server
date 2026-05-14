import { Outlet } from 'react-router';

export function AuthLayout() {
  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--color-background,#0f172a)] p-6">
      <div className="w-full max-w-md rounded-2xl bg-[var(--color-card,#ffffff)] p-8 shadow-xl">
        <Outlet />
      </div>
    </div>
  );
}
