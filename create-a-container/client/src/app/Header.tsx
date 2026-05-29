import {
  AppHeader,
  AppHeaderSection,
  AppHeaderActions,
  AppHeaderIconButton,
  AppHeaderUserMenu,
  Dropdown,
  DropdownContent,
  DropdownHeader,
  DropdownItem,
  DropdownSeparator,
  SidebarMobileToggle,
  useCommandPalette,
  useThemeContext,
} from '@mieweb/ui';
import { LogOut, Moon, Search, Settings, Sun } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useLogoutMutation, useSession } from '@/lib/auth';

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
  const logout = useLogoutMutation();
  const navigate = useNavigate();

  const isDark = resolvedTheme === 'dark';
  const isAdmin = !!session?.isAdmin;
  const userName = session?.user || 'Account';
  const roleLabel = isAdmin ? 'Administrator' : 'User';
  const initials = initialsOf(session?.user);

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
          <Dropdown
            placement="bottom-end"
            trigger={
              <AppHeaderUserMenu name={userName} email={roleLabel} initials={initials} />
            }
          >
            <DropdownHeader
              avatar={
                <div
                  className="flex size-8 items-center justify-center rounded-full bg-(--color-primary,#1d4ed8) text-xs font-semibold text-white"
                  aria-hidden="true"
                >
                  {initials}
                </div>
              }
              title={userName}
              subtitle={roleLabel}
            />
            <DropdownSeparator />
            <DropdownContent>
              {isAdmin && (
                <DropdownItem
                  icon={<Settings className="size-4" aria-hidden="true" />}
                  onClick={() => navigate('/settings')}
                >
                  Settings
                </DropdownItem>
              )}
              <DropdownItem
                icon={<LogOut className="size-4" aria-hidden="true" />}
                variant="danger"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                Sign out
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </AppHeaderActions>
      </AppHeaderSection>
    </AppHeader>
  );
}
