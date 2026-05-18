import { Outlet } from 'react-router';
import { Box } from 'lucide-react';

export function AuthLayout() {
  return (
    <div className="flex min-h-full items-center justify-center bg-(--color-background,#0f172a) p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-(--color-primary,#1d4ed8)">
          <Box className="size-7" />
          <span className="text-xl font-semibold tracking-tight">Container Manager</span>
        </div>
        <div className="rounded-2xl border border-(--color-border,#e2e8f0) bg-(--color-card,#ffffff) p-8 shadow-xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
