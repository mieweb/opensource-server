import type { ReactNode } from 'react';
import { Megaphone } from 'lucide-react';
import { useServerInfo } from '@/lib/auth';

/**
 * Turns "[text](url)" spans into anchors and leaves everything else as plain
 * text. Only http(s) URLs are linkified. Parsing into React nodes (instead of
 * injecting HTML) keeps the admin-provided message XSS-safe.
 */
function renderMessage(message: string): ReactNode[] {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of message.matchAll(linkPattern)) {
    if (match.index > cursor) nodes.push(message.slice(cursor, match.index));
    nodes.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold underline underline-offset-2 hover:opacity-80"
      >
        {match[1]}
      </a>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < message.length) nodes.push(message.slice(cursor));
  return nodes;
}

/**
 * Deployment-specific announcement strip. The message lives in the Settings
 * table (admin Settings page → "Announcement banner") and reaches the client
 * through GET /api/v1/health, so each environment controls its own banner
 * without any redeploy. Renders nothing when no message is configured.
 */
export function AppBanner() {
  const { data } = useServerInfo();
  const message = data?.banner?.trim();
  if (!message) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-[var(--mieweb-primary-700,#1786b3)] px-4 py-2 text-center text-sm text-white"
    >
      <Megaphone className="size-4 shrink-0" aria-hidden="true" />
      <span>{renderMessage(message)}</span>
    </div>
  );
}
