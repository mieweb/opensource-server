import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, Button, Input, Select } from '@mieweb/ui';
import { api, ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { MailAccountSecret } from '@/lib/types';

/** Inline create form — accounts can only be created on can-send domains. */
export function NewMailAccountForm({
  onCreated,
  onCancel,
}: {
  onCreated: (created: MailAccountSecret) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const { data: domains } = useQuery({ queryKey: keys.mailDomains(), queryFn: queries.listMailDomains });
  const [externalDomainId, setExternalDomainId] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.post<MailAccountSecret>('/api/v1/mail-accounts', {
        externalDomainId: parseInt(externalDomainId, 10),
        localPart,
        description: description || null,
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: keys.mailAccounts() });
      onCreated(created);
    },
  });

  if (domains && domains.length === 0) {
    return (
      <Alert variant="info">
        <AlertDescription>
          No domain can send mail yet. An administrator must enable mail on an external domain
          (publish its DNS records and pass Check DNS) before accounts can be created.
        </AlertDescription>
      </Alert>
    );
  }

  const domainName = domains?.find((d) => String(d.id) === externalDomainId)?.name;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="flex flex-col gap-3 rounded-lg border border-(--color-border,#e5e7eb) p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Domain"
          placeholder="Select a domain"
          value={externalDomainId}
          onValueChange={setExternalDomainId}
          options={(domains ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
        />
        <Input
          label="Address"
          placeholder="my-app"
          value={localPart}
          onChange={(e) => setLocalPart(e.target.value)}
          helperText={domainName ? `Will become ${localPart || '<address>'}@${domainName}` : undefined}
          required
        />
      </div>
      <Input
        label="Description"
        placeholder="What sends from this account?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {create.error && (
        <Alert variant="danger">
          <AlertDescription>{(create.error as ApiError).message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="cursor-pointer" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="cursor-pointer"
          isLoading={create.isPending}
          disabled={!externalDomainId || !localPart}
        >
          Create account
        </Button>
      </div>
    </form>
  );
}
