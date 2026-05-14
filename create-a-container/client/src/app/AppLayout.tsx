import { Outlet } from 'react-router';

export function AppLayout() {
  return (
    <div className="flex min-h-full flex-col bg-[var(--color-background,#f8fafc)] text-[var(--color-foreground,#0f172a)]">
      <header className="border-b border-[var(--color-border,#e2e8f0)] bg-[var(--color-card,#ffffff)] px-6 py-3">
        <h1 className="text-lg font-semibold">MIE Container Manager</h1>
      </header>
      <main className="flex-1 px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
