import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Select,
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
import { keys, queries } from '@/lib/queries';
import { useCurrentSiteId, setCurrentSiteId } from '@/lib/currentSite';

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
  const urlSiteId = siteMatch ? siteMatch[1] : null;

  const { data: sites } = useQuery({
    queryKey: keys.sites(),
    queryFn: queries.listSites,
  });

  const storedSiteId = useCurrentSiteId();

  // When the URL points at a specific site, treat that as the current site so
  // deep links and browser navigation keep the selector in sync.
  useEffect(() => {
    if (urlSiteId && urlSiteId !== storedSiteId) setCurrentSiteId(urlSiteId);
  }, [urlSiteId, storedSiteId]);

  // The current site persists across non-site pages. Validate the stored id
  // still exists in the available sites before using it for navigation.
  const currentSiteId =
    storedSiteId && sites?.some((s) => String(s.id) === storedSiteId) ? storedSiteId : null;

  const selectSite = (id: string) => {
    if (!id) return;
    setCurrentSiteId(id);
    navigate(`/sites/${id}/containers`);
  };

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
        {compact || !sites || sites.length === 0 ? (
          <SidebarNav>{PRIMARY.map(renderLink)}</SidebarNav>
        ) : (
          <div className="flex items-center gap-1 px-1">
            <div className="shrink-0">
              <SidebarNav>{PRIMARY.map(renderLink)}</SidebarNav>
            </div>
            <div className="min-w-0 flex-1">
              <Select
                label="Current site"
                hideLabel
                size="sm"
                placeholder="Select a site"
                value={currentSiteId ?? ''}
                onValueChange={selectSite}
                searchable={sites.length > 8}
                aria-label="Current site"
                options={sites.map((s) => ({ value: String(s.id), label: s.name }))}
              />
            </div>
          </div>
        )}
        {!compact && currentSiteId && (
          <div className="ml-5 mt-1 border-l border-border pl-2">
            <SidebarNav>
              {renderLink({
                to: `/sites/${currentSiteId}/containers`,
                label: 'Containers',
                icon: <ContainerIcon className="size-4" />,
                match: `/sites/${currentSiteId}/containers`,
              })}
              {isAdmin && renderLink({
                to: `/sites/${currentSiteId}/nodes`,
                label: 'Nodes',
                icon: <Server className="size-4" />,
                match: `/sites/${currentSiteId}/nodes`,
              })}
            </SidebarNav>
          </div>
        )}
        {/* When collapsed there is no room for the indent/dropdown, so show the
            site sub-links inline as a normal group. */}
        {compact && currentSiteId && (
          <SidebarNav className="mt-2">
            {renderLink({
              to: `/sites/${currentSiteId}/containers`,
              label: 'Containers',
              icon: <ContainerIcon className="size-4" />,
              match: `/sites/${currentSiteId}/containers`,
            })}
            {isAdmin && renderLink({
              to: `/sites/${currentSiteId}/nodes`,
              label: 'Nodes',
              icon: <Server className="size-4" />,
              match: `/sites/${currentSiteId}/nodes`,
            })}
          </SidebarNav>
        )}
        <SidebarNav className="mt-2">
          {ADMIN.filter((l) => !l.adminOnly || isAdmin).map(renderLink)}
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
