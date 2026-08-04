import { Badge } from '@mieweb/ui';
import type { Node } from '@/lib/types';

/** Whether the node advertises an NVIDIA GPU for container passthrough. */
export function NvidiaBadge({ n }: { n: Node }) {
  return n.nvidiaAvailable ? (
    <Badge variant="success">Available</Badge>
  ) : (
    <Badge variant="secondary">No</Badge>
  );
}
