import type { ReactNode } from 'react';
import {
  ThemeProvider,
  ToastProvider,
  SidebarProvider,
  CommandPaletteProvider,
} from '@mieweb/ui';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system">
      <ToastProvider position="top-right" maxToasts={5}>
        <SidebarProvider defaultCollapsed={false} storageKey="cac-sidebar-collapsed">
          <CommandPaletteProvider enableShortcut>{children}</CommandPaletteProvider>
        </SidebarProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
