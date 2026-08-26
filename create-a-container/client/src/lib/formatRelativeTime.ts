/**
 * "42s ago" / "5m ago" / "3h ago" / locale datetime / "never".
 *
 * Pass `secondsSince` when the server computed the age (e.g. the agents
 * endpoint's secondsSinceCheckin) so the judgment doesn't depend on the
 * client clock; otherwise the age is derived from Date.now(), which is fine
 * for display-only relative times.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  secondsSince?: number | null,
): string {
  if (!iso) return 'never';
  const seconds =
    secondsSince ?? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}
