import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, ServiceBadge, useToast } from '@mieweb/ui';
import { UserPlus } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';

/**
 * Presentational list of collaborator usernames rendered as removable chips.
 * Shared by the live manager and the create-form's collaborators field so
 * both surfaces look identical.
 */
export function CollaboratorChips({
  usernames,
  onRemove,
  disabled,
  emptyText = 'Not shared with anyone yet.',
}: {
  usernames: string[];
  onRemove: (username: string) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  if (usernames.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Shared with">
      {usernames.map((username) => (
        <li key={username}>
          <ServiceBadge
            variant="secondary"
            size="sm"
            removable
            onRemove={() => {
              if (!disabled) onRemove(username);
            }}
          >
            {username}
          </ServiceBadge>
        </li>
      ))}
    </ul>
  );
}

/**
 * An accessible username input + add button. Surfaces a validation/error
 * message (e.g. "user does not exist") inline beneath the field.
 */
export function AddCollaboratorField({
  onAdd,
  pending,
  error,
  label = 'Username',
}: {
  onAdd: (username: string) => void;
  pending?: boolean;
  error?: string | null;
  label?: string;
}) {
  const [value, setValue] = useState('');

  const submit = () => {
    const username = value.trim();
    if (!username) return;
    onAdd(username);
    setValue('');
  };

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Input
          label={label}
          placeholder="Enter a username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          error={error || undefined}
          hasError={!!error}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Submit on Enter without bubbling to an enclosing form.
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        leftIcon={<UserPlus className="size-4" />}
        isLoading={pending}
        disabled={!value.trim()}
        onClick={submit}
      >
        Share
      </Button>
    </div>
  );
}

/**
 * Live sharing manager for an existing container: lists current collaborators
 * and lets the owner/admin add or remove them via the API. Used both in the
 * list page's share dialog and the edit form's Sharing section.
 */
export function CollaboratorsManager({
  siteId,
  containerId,
  collaborators,
}: {
  siteId: string;
  containerId: number;
  collaborators: string[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [addError, setAddError] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.container(siteId, containerId) });
    qc.invalidateQueries({ queryKey: keys.containers(siteId) });
  };

  const add = useMutation({
    mutationFn: (username: string) => queries.shareContainer(siteId, containerId, username),
    onSuccess: (_data, username) => {
      setAddError(null);
      toast.success(`Shared with ${username}`);
      invalidate();
    },
    onError: (err: ApiError) => setAddError(err.message),
  });

  const remove = useMutation({
    mutationFn: (username: string) => queries.unshareContainer(siteId, containerId, username),
    onSuccess: (_data, username) => {
      toast.success(`Stopped sharing with ${username}`);
      invalidate();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <CollaboratorChips
        usernames={collaborators}
        onRemove={(u) => remove.mutate(u)}
        disabled={remove.isPending}
      />
      <AddCollaboratorField
        onAdd={(u) => add.mutate(u)}
        pending={add.isPending}
        error={addError}
      />
    </div>
  );
}
