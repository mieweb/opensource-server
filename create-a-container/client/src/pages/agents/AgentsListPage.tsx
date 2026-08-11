import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mieweb/ui';
import { Radio } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { keys, queries } from '@/lib/queries';
import type { Agent } from '@/lib/types';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { AgentServiceBadges } from './AgentServiceBadges';
import { OnlineBadge } from './OnlineBadge';

export function AgentsListPage() {
  useDocumentTitle('Agents');
  const { data, isLoading, error } = useQuery({
    queryKey: keys.agents(),
    queryFn: queries.listAgents,
    // Agents check in every 30s; keep the health view current.
    refetchInterval: 30000,
  });

  const hasAgents = !!data && data.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agents"
        subtitle="Site agents and their last check-in status"
        icon={<Radio className="size-6" />}
      />
      {error && (
        <Alert variant="danger">
          <AlertDescription>{(error as ApiError).message}</AlertDescription>
        </Alert>
      )}
      {isLoading && (
        <div className="flex justify-center p-12">
          <Spinner size="lg" />
        </div>
      )}
      {data && data.length === 0 && (
        <Alert variant="info">
          <AlertDescription>
            No agents have checked in yet. Agents register themselves at their first check-in.
          </AlertDescription>
        </Alert>
      )}

      {hasAgents && (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>Hostname</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>IPv4</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Last check-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((agent: Agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-medium">{agent.hostname}</TableCell>
                <TableCell>{agent.siteName || agent.siteId}</TableCell>
                <TableCell className="font-mono text-sm">{agent.ipv4Address || '—'}</TableCell>
                <TableCell>
                  <OnlineBadge agent={agent} />
                </TableCell>
                <TableCell>
                  <AgentServiceBadges services={agent.services} />
                </TableCell>
                <TableCell>{formatRelativeTime(agent.lastCheckinAt, agent.secondsSinceCheckin)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
