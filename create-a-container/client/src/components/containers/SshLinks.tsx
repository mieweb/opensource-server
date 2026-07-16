import { Code2, Terminal } from 'lucide-react';
import type { Container } from '@/lib/types';
import { linkClass } from './shared';

/** A container's SSH endpoint with VS Code Remote and terminal deep links. */
export function SshLinks({ c, sessionUser }: { c: Container; sessionUser?: string }) {
  if (!c.sshHost || !c.sshPort) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs">
      <span className="whitespace-nowrap">
        {c.sshHost}:{c.sshPort}
      </span>
      {sessionUser && (
        <>
          <a
            href={`vscode://vscode-remote/ssh-remote+${sessionUser}@${c.sshHost}:${c.sshPort}/`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in VS Code"
            aria-label={`Open SSH in VS Code for container ${c.hostname}`}
            className={linkClass}
          >
            <Code2 className="size-4" aria-hidden="true" />
          </a>
          <a
            href={`ssh://${sessionUser}@${c.sshHost}:${c.sshPort}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open SSH in terminal"
            aria-label={`Open SSH terminal for container ${c.hostname}`}
            className={linkClass}
          >
            <Terminal className="size-4" aria-hidden="true" />
          </a>
        </>
      )}
    </span>
  );
}
