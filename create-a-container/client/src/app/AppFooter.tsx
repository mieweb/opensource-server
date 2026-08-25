import { useLocation } from 'react-router';
import { Bug } from 'lucide-react';
import { useServerInfo, useSession } from '@/lib/auth';

const REPO_URL = 'https://github.com/mieweb/opensource-server';

/**
 * App-wide footer showing the running version (linked to its commit) and a
 * "Report a bug" link that pre-fills the GitHub bug-report template with the
 * current URL, username, and version.
 */
export function AppFooter() {
  const { data: serverInfo } = useServerInfo();
  const { data: session } = useSession();
  const location = useLocation();

  const version = serverInfo?.version;
  const params = new URLSearchParams({ template: 'bug_report.yml', url: location.pathname });
  if (session?.user) params.set('username', session.user);
  if (version) params.set('version', version.display);
  const bugReportUrl = `${REPO_URL}/issues/new?${params.toString()}`;

  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-(--color-border,#e5e7eb) px-4 py-2 text-xs text-(--color-muted,#6b7280)">
      {version && (
        <a
          href={version.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          aria-label={`Version ${version.display} — view commit on GitHub`}
        >
          Version {version.display} ({version.date})
        </a>
      )}
      <a
        href={bugReportUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 hover:underline"
        aria-label="Report a bug on GitHub"
      >
        <Bug className="size-3.5" aria-hidden="true" />
        <span>Report a bug</span>
      </a>
    </footer>
  );
}
