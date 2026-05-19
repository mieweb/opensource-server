import {
  AppHeader,
  AppHeaderSection,
  AppHeaderActions,
  AppHeaderIconButton,
  AppHeaderUserMenu,
  SidebarMobileToggle,
  useThemeContext,
} from '@mieweb/ui';
import { Moon, Search, Sun } from 'lucide-react';
import { useSession } from '@/lib/auth';
import { useCommandPalette } from '@mieweb/ui';

function initialsOf(name: string | undefined) {
  if (!name) return '?';
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function AppTopHeader() {
  const { data: session } = useSession();
  const { resolvedTheme, setTheme } = useThemeContext();
  const palette = useCommandPalette();

  const isDark = resolvedTheme === 'dark';

  return (
    <AppHeader sticky bordered>
      <AppHeaderSection align="left">
        <SidebarMobileToggle className="lg:hidden" />
        {/* Sidebar already shows the brand on desktop; only repeat it on mobile
            where the sidebar is collapsed off-canvas. AppHeaderBrand itself
            is hidden below md by the library, so render a plain span. */}
        <span className="font-semibold tracking-tight lg:hidden">Container Manager</span>
      </AppHeaderSection>
      <AppHeaderSection align="right">
        <AppHeaderActions>
          <AppHeaderIconButton
            icon={<Search className="size-4" />}
            label="Search (⌘K)"
            onClick={palette.open}
          />
          <AppHeaderIconButton
            icon={isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          />
          <AppHeaderUserMenu
            name={session?.user || 'Account'}
            email={session?.isAdmin ? 'Administrator' : 'User'}
            initials={initialsOf(session?.user)}
          />
        </AppHeaderActions>
      </AppHeaderSection>
    </AppHeader>
  );
}
