import { Badge } from '@mieweb/ui';
import type { Container } from '@/lib/types';

/**
 * Whether sshd inside the container enforces the sharing list (owner +
 * collaborators). Containers created before enforcement existed stay open
 * until enrolled.
 */
export function SshAccessBadge({ container }: { container: Pick<Container, 'sshAccessEnforced'> }) {
  return container.sshAccessEnforced ? (
    <Badge variant="success" aria-label="SSH access is limited to the owner and collaborators">
      SSH enforced
    </Badge>
  ) : (
    <Badge
      variant="warning"
      aria-label="SSH access is not limited to the owner and collaborators; enrollment required"
    >
      SSH not enforced
    </Badge>
  );
}
