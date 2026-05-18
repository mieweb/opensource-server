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
  Settings,
  Users,
  UsersRound,
  Container as ContainerIcon,
} from 'lucide-react';
import { useSession, useLogoutMutation } from '@/lib/auth';

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
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
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
      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-2 py-2 text-xs text-(--color-muted-foreground,#64748b)">
          <span className="truncate">{session?.user}</span>
          <button
            type="button"
            className="rounded-md px-2 py-1 hover:bg-(--color-muted,#f1f5f9)"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        <SidebarToggle />
      </SidebarFooter>
    </>
  );
}
