import { useLocation } from 'react-router';
import { Bug } from 'lucide-react';
import { useSession } from '@/lib/auth';

const REPO_URL = 'https://github.com/mieweb/opensource-server';

// Baked in at build time (vite define): the packaging build writes the release
// version into package.json before `vite build`; dev builds keep 0.0.0.
const VERSION = __APP_VERSION__ === '0.0.0' ? null : __APP_VERSION__;

/**
 * App-wide footer showing the running version (linked to the GitHub releases)
 * and a "Report a bug" link that pre-fills the GitHub bug-report template with
 * the current URL, username, and version.
 */
export function AppFooter() {
  const { data: session } = useSession();
  const location = useLocation();

  const params = new URLSearchParams({ template: 'bug_report.yml', url: location.pathname });
  if (session?.user) params.set('username', session.user);
  params.set('version', VERSION ?? 'dev');
  const bugReportUrl = `${REPO_URL}/issues/new?${params.toString()}`;

  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-(--color-border,#e5e7eb) px-4 py-2 text-xs text-(--color-muted,#6b7280)">
      {VERSION ? (
        <a
          href={`${REPO_URL}/releases`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          aria-label={`Version ${VERSION} — view releases on GitHub`}
        >
          Version {VERSION}
        </a>
      ) : (
        <span>Development build</span>
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
