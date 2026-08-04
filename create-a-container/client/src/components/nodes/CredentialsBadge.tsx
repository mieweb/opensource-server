import { Badge } from '@mieweb/ui';
import type { Node } from '@/lib/types';

/** Whether the node has the credentials it needs to reach its hypervisor/host. */
export function CredentialsBadge({ n }: { n: Node }) {
  if (n.nodeType === 'dummy') {
    return <Badge variant="secondary">Not required</Badge>;
  }

  if (n.nodeType === 'docker') {
    return n.apiUrl ? (
      <Badge variant="success">Host set</Badge>
    ) : (
      <Badge variant="warning">Missing</Badge>
    );
  }

  return n.hasSecret ? (
    <Badge variant="success">Set</Badge>
  ) : (
    <Badge variant="warning">Missing</Badge>
  );
}
