/**
 * Notification bell — replaces the (unused) header search button. Polls the
 * owner-scoped notification feed, shows an unread badge, and renders the shared
 * @mieweb/ui NotificationCenter (list, empty/loading states, mark-(all-)read)
 * inside a dropdown.
 *
 * The feed is returned unacked-first + newest-first, so the unread count is
 * derived directly from the fetched rows (capped by the server's page size —
 * displayed as "N+" when saturated).
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppHeaderIconButton,
  Dropdown,
  NotificationCenter,
  type Notification as UINotification,
} from '@mieweb/ui';
import { Bell } from 'lucide-react';
import { keys, queries } from '@/lib/queries';
import type { AppNotification, NotificationSeverity } from '@/lib/types';

// The server caps the list; keep this in sync with the API default (20).
const PAGE_SIZE = 20;

// Map our event severity onto the shared component's icon `type` and `priority`.
const SEVERITY_TYPE: Record<NotificationSeverity, UINotification['type']> = {
  info: 'system',
  warning: 'alert',
  critical: 'alert',
};
const SEVERITY_PRIORITY: Record<NotificationSeverity, UINotification['priority']> = {
  info: 'normal',
  warning: 'high',
  critical: 'urgent',
};

/** A concise title, e.g. "critical · freeze — pve1 · CT 392". */
function titleFor(n: AppNotification): string {
  const lead = [n.severity, n.action].filter(Boolean).join(' · ');
  const target = [n.node, n.ctid ? `CT ${n.ctid}` : null].filter(Boolean).join(' · ');
  return target ? `${lead} — ${target}` : lead;
}

/** Adapt an API notification to the @mieweb/ui NotificationCenter shape. */
function toUINotification(n: AppNotification): UINotification {
  return {
    id: String(n.id),
    type: SEVERITY_TYPE[n.severity],
    title: titleFor(n),
    message: n.message,
    timestamp: n.eventAt || n.createdAt,
    isRead: !!n.acknowledgedAt,
    senderName: n.source,
    priority: SEVERITY_PRIORITY[n.severity],
  };
}

export function NotificationsBell() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: keys.notifications(),
    queryFn: queries.listNotifications,
    refetchInterval: 30000,
  });

  const notifications = useMemo(() => data ?? [], [data]);
  const uiNotifications = useMemo(() => notifications.map(toUINotification), [notifications]);
  const unreadCount = notifications.filter((n) => !n.acknowledgedAt).length;

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
      width={380}
      trigger={
        <AppHeaderIconButton
          icon={<Bell className="size-4" />}
          label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          badge={unreadCount > 0 ? unreadCount : undefined}
        />
      }
    >
      <NotificationCenter
        notifications={uiNotifications}
        isLoading={isLoading}
        maxVisible={PAGE_SIZE}
        emptyMessage="No notifications."
        onMarkRead={(id) => ackOne.mutate(Number(id))}
        onMarkAllRead={() => ackAll.mutate()}
        // Sits inside the Dropdown's own panel; drop the component's border and
        // shadow so it renders flush rather than as a card-within-a-card.
        // (className is appended after the component's base classes, so these
        // utilities win.)
        className="!border-0 !shadow-none"
      />
    </Dropdown>
  );
}
