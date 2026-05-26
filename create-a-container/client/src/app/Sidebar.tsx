import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  SidebarNav,
  SidebarNavItem,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarToggle,
  useSidebar,
} from '@mieweb/ui';
import {
  Box,
  Building2,
  Container as ContainerIcon,
  ExternalLink,
  Globe,
  KeyRound,
  Server,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
} from 'lucide-react';
import { useSession } from '@/lib/auth';

function initialsOf(name: string | undefined) {
  if (!name) return '?';
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

interface NavLink {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  /** Match this prefix to mark active (defaults to exact `to`). */
  match?: string;
}

const PRIMARY: NavLink[] = [
  { to: '/sites', label: 'Sites', icon: <Building2 className="size-4" />, match: '/sites' },
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
  const { isCollapsed, isMobileViewport } = useSidebar();
  const isAdmin = !!session?.isAdmin;
  const mfaAdminUrl =
    isAdmin && session?.pushNotificationUrl ? `${session.pushNotificationUrl}/admin` : null;

  const siteMatch = location.pathname.match(/^\/sites\/(\d+)(?:\/|$)/);
  const activeSiteId = siteMatch ? siteMatch[1] : null;

  // Treat the sidebar as compact only on desktop collapse; on mobile the off-canvas
  // panel is full-width and should always show labels.
  const compact = isCollapsed && !isMobileViewport;

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
        <div className="flex items-center gap-2 overflow-hidden">
          <Box className="size-6 shrink-0 text-(--color-primary,#1d4ed8)" />
          {!compact && (
            <span className="truncate font-semibold tracking-tight">Container Manager</span>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav>{PRIMARY.map(renderLink)}</SidebarNav>
        {activeSiteId && (
          <SidebarNav className="mt-2">
            {renderLink({
              to: `/sites/${activeSiteId}/containers`,
              label: 'Containers',
              icon: <ContainerIcon className="size-4" />,
              match: `/sites/${activeSiteId}/containers`,
            })}
            {isAdmin && renderLink({
              to: `/sites/${activeSiteId}/nodes`,
              label: 'Nodes',
              icon: <Server className="size-4" />,
              match: `/sites/${activeSiteId}/nodes`,
            })}
          </SidebarNav>
        )}
        {mfaAdminUrl && (
          <SidebarNavItem
            key="mfa-admin"
            label="MFA Admin"
            icon={<ShieldCheck className="size-4" />}
            badge={compact ? undefined : <ExternalLink className="size-3" aria-hidden="true" />}
            isActive={false}
            onClick={() => window.open(mfaAdminUrl, '_blank', 'noopener,noreferrer')}
          />
        )}
        <SidebarNav className="mt-2">
          {ADMIN.filter((l) => !l.adminOnly || isAdmin).map(renderLink)}
        </SidebarNav>
      </SidebarContent>
      <SidebarFooter className="border-t border-neutral-200 p-2 dark:border-neutral-700">
        <div
          className={
            compact
              ? 'flex flex-col items-center gap-1 px-1 py-2'
              : 'flex items-center gap-2 rounded-md px-2 py-2'
          }
        >
          {!isMobileViewport && <SidebarToggle />}
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--color-primary,#1d4ed8) text-xs font-semibold text-white"
            aria-hidden="true"
            title={compact ? session?.user || 'Account' : undefined}
          >
            {initialsOf(session?.user)}
          </div>
          {!compact && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-(--color-foreground,#0f172a)">
                {session?.user || 'Account'}
              </div>
              <div className="truncate text-xs text-(--color-muted-foreground,#64748b)">
                {isAdmin ? 'Administrator' : 'User'}
              </div>
            </div>
          )}
        </div>
      </SidebarFooter>
    </>
  );
}
