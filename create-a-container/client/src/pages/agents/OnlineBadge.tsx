import { Badge } from '@mieweb/ui';
import type { Agent } from '@/lib/types';

// Agents check in every 30 seconds; three missed intervals means offline.
const OFFLINE_AFTER_SECONDS = 90;

export function OnlineBadge({ agent }: { agent: Agent }) {
  const online =
    agent.secondsSinceCheckin !== null && agent.secondsSinceCheckin <= OFFLINE_AFTER_SECONDS;
  return online ? (
    <Badge variant="success">Online</Badge>
  ) : (
    <Badge variant="danger">Offline</Badge>
  );
}
