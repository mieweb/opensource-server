/**
 * Notification bell — replaces the (unused) header search button. Polls the
 * owner-scoped notification feed, shows an unread badge, and lets the user
 * acknowledge events individually or all at once from a dropdown.
 *
 * The feed is returned unacked-first + newest-first, so the unread count is
 * derived directly from the fetched rows (capped by the server's page size —
 * displayed as "N+" when saturated).
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppHeaderIconButton,
  Badge,
  Dropdown,
  DropdownHeader,
  DropdownSeparator,
  Spinner,
  formatLastSeen,
} from '@mieweb/ui';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { keys, queries } from '@/lib/queries';
import type { AppNotification, NotificationSeverity } from '@/lib/types';

// The server caps the list; keep this in sync with the API default (20).
const PAGE_SIZE = 20;

const SEVERITY_VARIANT: Record<NotificationSeverity, 'default' | 'warning' | 'danger'> = {
  info: 'default',
  warning: 'warning',
  critical: 'danger',
};

/** Relative time via @mieweb/ui ("just now", "5m ago", ...); '' for missing/invalid dates. */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatLastSeen(date);
}

function NotificationRow({
  n,
  onAck,
  acking,
}: {
  n: AppNotification;
  onAck: (id: number) => void;
  acking: boolean;
}) {
  const isUnread = !n.acknowledgedAt;
  const target = [n.node, n.ctid ? `CT ${n.ctid}` : null].filter(Boolean).join(' · ');
  return (
    <div
      className={`flex gap-2 px-3 py-2 text-sm ${isUnread ? 'bg-(--color-muted,rgba(0,0,0,0.03))' : ''}`}
    >
      <div className="mt-0.5">
        <Badge variant={SEVERITY_VARIANT[n.severity]} size="sm">
          {n.severity}
        </Badge>
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words">{n.message}</p>
        <p className="mt-0.5 text-xs text-(--color-muted-foreground,#6b7280)">
          {[n.source, target].filter(Boolean).join(' • ')}
          {' · '}
          {relativeTime(n.eventAt || n.createdAt)}
        </p>
      </div>
      {isUnread && (
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded p-1 text-(--color-muted-foreground,#6b7280) hover:bg-(--color-muted,rgba(0,0,0,0.06)) disabled:opacity-50"
          title="Mark as read"
          aria-label="Mark as read"
          disabled={acking}
          onClick={() => onAck(n.id)}
        >
          <Check className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function NotificationsBell() {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: keys.notifications(),
    queryFn: queries.listNotifications,
    refetchInterval: 30000,
  });

  const notifications = useMemo(() => data ?? [], [data]);
  const unreadCount = notifications.filter((n) => !n.acknowledgedAt).length;
  const badge = unreadCount > 0 ? unreadCount : undefined;

  const invalidate = () => qc.invalidateQueries({ queryKey: keys.notifications() });

  const ackOne = useMutation({
    mutationFn: (id: number) => queries.ackNotification(id),
    onSuccess: invalidate,
  });
  const ackAll = useMutation({
    mutationFn: () => queries.ackAllNotifications(),
    onSuccess: invalidate,
  });

  return (
    <Dropdown
      placement="bottom-end"
      width={360}
      trigger={
        <AppHeaderIconButton
          icon={<Bell className="size-4" />}
          label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          badge={badge}
        />
      }
    >
      <DropdownHeader
        title="Notifications"
        subtitle={
          unreadCount > 0
            ? `${unreadCount}${unreadCount >= PAGE_SIZE ? '+' : ''} unread`
            : 'All caught up'
        }
      />
      <DropdownSeparator />
      <div className="max-h-96 overflow-y-auto">
        {isLoading && (
          <div className="flex justify-center px-3 py-6">
            <Spinner />
          </div>
        )}
        {isError && (
          <p className="px-3 py-6 text-center text-sm text-(--color-danger,#dc2626)">
            Failed to load notifications.
          </p>
        )}
        {!isLoading && !isError && notifications.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-(--color-muted-foreground,#6b7280)">
            No notifications.
          </p>
        )}
        {notifications.map((n) => (
          <NotificationRow
            key={n.id}
            n={n}
            onAck={(id) => ackOne.mutate(id)}
            acking={ackOne.isPending}
          />
        ))}
      </div>
      {unreadCount > 0 && (
        <>
          <DropdownSeparator />
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium hover:bg-(--color-muted,rgba(0,0,0,0.06)) disabled:opacity-50"
            disabled={ackAll.isPending}
            onClick={() => ackAll.mutate()}
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            Mark all as read
          </button>
        </>
      )}
    </Dropdown>
  );
}
