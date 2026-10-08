import { Alert, AlertDescription, Button, useToast } from '@mieweb/ui';
import type { MailAccountSecret } from '@/lib/types';

/** One-time password + connection settings shown after create/rotate. */
export function MailCredentialsAlert({
  created,
  onDismiss,
}: {
  created: MailAccountSecret;
  onDismiss: () => void;
}) {
  const toast = useToast();
  const copy = (value: string) => {
    navigator.clipboard.writeText(value).catch(() => undefined);
    toast.success('Copied to clipboard');
  };
  return (
    <Alert variant="success" role="status" aria-live="polite">
      <AlertDescription>
        <div className="flex flex-col gap-2">
          <strong>{created.warning}</strong>
          <div className="flex items-center gap-2">
            <code className="rounded bg-zinc-100 px-2 py-1 font-mono text-sm break-all text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
              {created.password}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => copy(created.password)}
              aria-label="Copy password to clipboard"
            >
              Copy
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-medium">Username</dt>
            <dd className="font-mono">{created.connection.username}</dd>
            <dt className="font-medium">Server</dt>
            <dd className="font-mono">{created.connection.host}</dd>
            <dt className="font-medium">SMTP</dt>
            <dd>
              ports {created.connection.smtp.ports.join(', ')} (STARTTLS on 587, implicit TLS on 465)
            </dd>
            <dt className="font-medium">IMAP</dt>
            <dd>ports {created.connection.imap.ports.join(', ')}</dd>
          </dl>
          <div>
            <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
