import { useNavigate, useLocation } from 'react-router';
import {
  SidebarNav,
  SidebarNavItem,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarToggle,
} from '@mieweb/ui';
import {
  Box,
  Building2,
  Globe,
  KeyRound,
  LogOut,
  Settings,
  Users,
  UsersRound,
  Container as ContainerIcon,
} from 'lucide-react';
import { useSession, useLogoutMutation } from '@/lib/auth';

function initialsOf(name: string | undefined) {
  if (!name) return '?';
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

interface NavLink {
  to: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  /** Match this prefix to mark active (defaults to exact `to`). */
  match?: string;
}

const PRIMARY: NavLink[] = [
  { to: '/sites', label: 'Sites', icon: <Building2 className="size-4" />, match: '/sites' },
  {
    to: '/containers',
    label: 'Containers',
    icon: <ContainerIcon className="size-4" />,
    match: '/containers',
  },
];

const ADMIN: NavLink[] = [
  { to: '/users', label: 'Users', icon: <Users className="size-4" />, adminOnly: true },
  { to: '/groups', label: 'Groups', icon: <UsersRound className="size-4" />, adminOnly: true },
  {
    to: '/external-domains',
    label: 'External Domains',
    icon: <Globe className="size-4" />,
    adminOnly: true,
  },
  { to: '/apikeys', label: 'API Keys', icon: <KeyRound className="size-4" /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="size-4" />, adminOnly: true },
];

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = useSession();
  const logout = useLogoutMutation();
  const isAdmin = !!session?.isAdmin;

  const isActive = (link: NavLink) => {
    const prefix = link.match ?? link.to;
    return location.pathname === prefix || location.pathname.startsWith(`${prefix}/`);
  };

  const renderLink = (link: NavLink) => (
    <SidebarNavItem
      key={link.to}
      label={link.label}
      icon={link.icon}
      isActive={isActive(link)}
      onClick={() => navigate(link.to)}
    />
  );

  return (
    <>
      <SidebarHeader className="h-16 px-4 py-0">
        <div className="flex items-center gap-2">
          <Box className="size-6 text-(--color-primary,#1d4ed8)" />
          <span className="font-semibold tracking-tight">Container Manager</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav>{PRIMARY.map(renderLink)}</SidebarNav>
        <SidebarNav className="mt-2">
          {ADMIN.filter((l) => !l.adminOnly || isAdmin).map(renderLink)}
        </SidebarNav>
      </SidebarContent>
      <SidebarFooter className="border-t border-neutral-200 p-2 dark:border-neutral-700">
        <div className="flex items-center gap-2 rounded-md px-2 py-2">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--color-primary,#1d4ed8) text-xs font-semibold text-white"
            aria-hidden="true"
          >
            {initialsOf(session?.user)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-(--color-foreground,#0f172a)">
              {session?.user || 'Account'}
            </div>
            <div className="truncate text-xs text-(--color-muted-foreground,#64748b)">
              {isAdmin ? 'Administrator' : 'User'}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-(--color-muted-foreground,#64748b) hover:bg-(--color-muted,#f1f5f9) hover:text-(--color-foreground,#0f172a) disabled:opacity-50"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
        <SidebarToggle />
      </SidebarFooter>
    </>
  );
}
