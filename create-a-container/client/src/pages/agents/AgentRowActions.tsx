import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, useToast } from '@mieweb/ui';
import { KeyRound, MailMinus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { Agent } from '@/lib/types';

/** Admin actions on one agent row: release the mail-host claim (holder only)
 * and clear the API-key pin (remote agents re-pin on their next check-in). */
export function AgentRowActions({ agent }: { agent: Agent }) {
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.agents() });
    qc.invalidateQueries({ queryKey: keys.mailHost() });
  };

  const release = useMutation({
    mutationFn: () => api.post('/api/v1/mail/host/release'),
    onSuccess: () => {
      toast.success('Mail-host claim released — the next qualifying check-in takes it');
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const clearPin = useMutation({
    mutationFn: () => api.delete(`/api/v1/agents/${agent.id}/api-key-pin`),
    onSuccess: () => {
      toast.success('API-key pin cleared');
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (!agent.mailHostSince && !agent.hasApiKeyPin) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {agent.mailHostSince && (
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          leftIcon={<MailMinus className="size-4" />}
          onClick={() => {
            if (confirm(`Release the mail-host claim held by ${agent.hostname}? Its mail services stop; mailboxes stay in place.`)) {
              release.mutate();
            }
          }}
          disabled={release.isPending}
        >
          Release mail host
        </Button>
      )}
      {agent.hasApiKeyPin && (
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          leftIcon={<KeyRound className="size-4" />}
          onClick={() => {
            if (confirm(`Clear the API-key pin for ${agent.hostname}? It re-pins to whatever key its next check-in presents.`)) {
              clearPin.mutate();
            }
          }}
          disabled={clearPin.isPending}
        >
          Clear key pin
        </Button>
      )}
    </div>
  );
}
