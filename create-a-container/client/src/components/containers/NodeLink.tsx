import type { Container } from '@/lib/types';
import { linkClass } from './shared';

/** Node name linked to the node's Proxmox web UI (LXC view when provisioned). */
export function NodeLink({ c }: { c: Container }) {
  if (!c.nodeApiUrl) return <>{c.nodeName || '—'}</>;
  return (
    <a
      href={`${c.nodeApiUrl}${c.containerId ? `/#v1:0:=lxc%2F${c.containerId}:4:::::::` : ''}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open node in Proxmox web UI"
      className={linkClass}
    >
      {c.nodeName || c.nodeApiUrl}
    </a>
  );
}
