import { Outlet } from 'react-router';
import { Sidebar, CommandPalette } from '@mieweb/ui';
import { AppSidebar } from './Sidebar';
import { AppTopHeader } from './Header';

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-(--color-background,#f8fafc) text-(--color-foreground,#0f172a)">
      <Sidebar>
        <AppSidebar />
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopHeader />
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette placeholder="Search…" />
    </div>
  );
}
