import { ExternalLink } from 'lucide-react';
import type { Container } from '@/lib/types';
import { linkClass } from './shared';

/** External links for a container's HTTP services, optionally capped at `limit`. */
export function HttpLinks({ c, limit }: { c: Container; limit?: number }) {
  if (c.httpEntries.length === 0) return <span className="text-muted-foreground">—</span>;
  const entries = limit ? c.httpEntries.slice(0, limit) : c.httpEntries;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {entries.map((h) =>
        h.externalUrl ? (
          <a
            key={`${c.id}-${h.port}`}
            href={h.externalUrl}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1 text-xs ${linkClass}`}
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            <span className="break-all">{h.externalUrl.replace(/^https?:\/\//, '')}</span>
          </a>
        ) : (
          <span key={`${c.id}-${h.port}`} className="text-xs">
            :{h.port}
          </span>
        ),
      )}
    </span>
  );
}
