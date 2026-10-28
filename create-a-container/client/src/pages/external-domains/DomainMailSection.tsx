import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, AlertDescription, Badge, Button, Spinner,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast,
} from '@mieweb/ui';
import { Copy, MailCheck, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { ExternalDomain, MailDnsCheckResult } from '@/lib/types';

const GATES: { key: keyof Pick<MailDnsCheckResult, 'spf' | 'dkim' | 'dmarc' | 'mx'>; label: string }[] = [
  { key: 'spf', label: 'SPF' },
  { key: 'dkim', label: 'DKIM' },
  { key: 'dmarc', label: 'DMARC' },
  { key: 'mx', label: 'MX' },
];

/** Mail enablement for one external domain: records to publish (with copy
 * buttons), Check DNS, enable/disable, and send/receive badges with reasons. */
export function DomainMailSection({ domain }: { domain: ExternalDomain }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: keys.mailDns(domain.id),
    queryFn: () => queries.getDomainMailDns(domain.id),
  });
  const { data: host } = useQuery({ queryKey: keys.mailHost(), queryFn: queries.getMailHost });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.mailDns(domain.id) });
    qc.invalidateQueries({ queryKey: keys.externalDomain(domain.id) });
    qc.invalidateQueries({ queryKey: keys.externalDomains() });
  };

  const action = useMutation({
    mutationFn: (verb: 'check-dns' | 'enable' | 'disable') =>
      api.post(`/api/v1/external-domains/${domain.id}/mail/${verb}`),
    onSuccess: (_data, verb) => {
      toast.success(
        verb === 'check-dns' ? 'DNS re-checked' : verb === 'enable' ? 'Mail enabled' : 'Mail disabled',
      );
      invalidate();
    },
    onError: (err: ApiError) => {
      toast.error(err.message);
      invalidate(); // check-dns ran even when enable was refused
    },
  });

  const copy = (value: string) => {
    navigator.clipboard.writeText(value).catch(() => undefined);
    toast.success('Copied to clipboard');
  };

  if (isLoading || !data) {
    return (
      <div className="flex justify-center p-6">
        <Spinner size="md" />
      </div>
    );
  }

  const canSend = data.mailEnabled && data.mailDnsVerified;
  const canReceive = data.mailEnabled && data.mailMxVerified;
  const check = data.lastCheck?.result ?? null;
  const noMailHost = host && !host.agent && !host.selfManagedSiteId;

  return (
    <section aria-labelledby="domain-mail-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="domain-mail-heading" className="flex items-center gap-2 text-lg font-semibold">
          <MailCheck className="size-5" /> Mail
        </h2>
        <div className="flex flex-wrap gap-1">
          <Badge
            variant={canSend ? 'success' : 'secondary'}
            title={canSend ? 'Accounts on this domain can send' : !data.mailEnabled ? 'Mail is not enabled' : 'SPF/DKIM/DMARC not verified'}
          >
            {canSend ? 'Can send' : "Can't send"}
          </Badge>
          <Badge
            variant={canReceive ? 'success' : 'secondary'}
            title={canReceive ? 'MX points at the mail host' : !data.mailEnabled ? 'Mail is not enabled' : 'MX does not resolve to the mail IP'}
          >
            {canReceive ? 'Can receive' : "Can't receive"}
          </Badge>
        </div>
      </div>

      {noMailHost && (
        <Alert variant="warning">
          <AlertDescription>
            No agent currently runs the mail service and no self-managed site is configured — mail
            can be prepared here but nothing will deliver it. See the Agents page.
          </AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-(--color-muted,#6b7280)">
        Publish these DNS records, then run Check DNS. Sending needs SPF, DKIM, and DMARC;
        receiving needs the MX record.
      </p>
      <Table responsive>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="w-px text-right">
              <span className="sr-only">Copy</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.records.map((r) => (
            <TableRow key={`${r.type}-${r.name}`}>
              <TableCell>{r.type}</TableCell>
              <TableCell className="font-mono text-xs">{r.name}</TableCell>
              <TableCell className="max-w-md truncate font-mono text-xs" title={r.value}>
                {r.value}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer"
                  leftIcon={<Copy className="size-4" />}
                  onClick={() => copy(r.value)}
                  aria-label={`Copy ${r.type} record for ${r.name}`}
                >
                  <span className="sr-only">Copy</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {check && (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="mr-1">
            Last check {new Date(check.checkedAt).toLocaleString()}:
          </span>
          {GATES.map(({ key, label }) => (
            <Badge key={key} variant={check[key]?.pass ? 'success' : 'danger'}>
              {label}
            </Badge>
          ))}
        </div>
      )}
      {check && check.warnings.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <ul className="list-inside list-disc">
              {check.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer"
          leftIcon={<RefreshCw className="size-4" />}
          isLoading={action.isPending && action.variables === 'check-dns'}
          onClick={() => action.mutate('check-dns')}
        >
          Check DNS
        </Button>
        {data.mailEnabled ? (
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            isLoading={action.isPending && action.variables === 'disable'}
            onClick={() => {
              if (confirm(`Disable mail for ${domain.name}? Accounts stop authenticating immediately; DKIM keys and config are kept.`)) {
                action.mutate('disable');
              }
            }}
          >
            Disable mail
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            className="cursor-pointer"
            isLoading={action.isPending && action.variables === 'enable'}
            onClick={() => action.mutate('enable')}
          >
            Enable mail
          </Button>
        )}
      </div>
    </section>
  );
}
