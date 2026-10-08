import { Badge } from '@mieweb/ui';
import type { Agent } from '@/lib/types';

/** Mail-host claim state for one agent row. */
export function MailHostBadge({ agent }: { agent: Agent }) {
  if (agent.mailHostSince) {
    return (
      <Badge variant="success" title={`Mail host since ${new Date(agent.mailHostSince).toLocaleString()}`}>
        Mail host
      </Badge>
    );
  }
  if (!agent.enabledServices?.includes('mail')) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (agent.missingBinaries && agent.missingBinaries.length > 0) {
    return (
      <Badge variant="warning" title={`Install on the agent host: ${agent.missingBinaries.join(', ')}`}>
        Missing packages
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" title="Reports the mail group but another agent holds the claim">
      Standby
    </Badge>
  );
}
