import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useToast,
} from '@mieweb/ui';
import { UserRoundCog } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';

/** Admin-only control to transfer a container to another user (server-enforced). */
export function TransferOwnership({
  siteId,
  containerId,
  hostname,
  owner,
}: {
  siteId: string;
  containerId: number;
  hostname: string;
  owner: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newOwner = value.trim();

  const transfer = useMutation({
    mutationFn: () => queries.transferContainerOwnership(siteId, containerId, newOwner),
    onSuccess: (result) => {
      setConfirmOpen(false);
      setError(null);
      setValue('');
      toast.success(result.message);
      qc.invalidateQueries({ queryKey: keys.containers(siteId) });
      qc.invalidateQueries({ queryKey: keys.container(siteId, containerId) });
    },
    onError: (err: ApiError) => {
      setConfirmOpen(false);
      setError(err.message);
    },
  });

  const canSubmit = !!newOwner && newOwner !== owner;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Current owner: <strong>{owner}</strong>
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="New owner"
            placeholder="Enter a username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            error={error || undefined}
            hasError={!!error}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              // Keep Enter from submitting the enclosing container form.
              if (e.key === 'Enter') {
                e.preventDefault();
                if (canSubmit) setConfirmOpen(true);
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer"
          leftIcon={<UserRoundCog className="size-4" />}
          disabled={!canSubmit}
          onClick={() => setConfirmOpen(true)}
        >
          Transfer
        </Button>
      </div>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ModalHeader>
          <ModalTitle>Transfer ownership?</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <p className="text-sm">
            <strong>{hostname}</strong> will be owned by <strong>{newOwner}</strong>. Its approved
            resources and volume data move with it. {owner} will lose access unless the new owner
            shares it with them.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            className="cursor-pointer"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            className="cursor-pointer"
            isLoading={transfer.isPending}
            onClick={() => transfer.mutate()}
          >
            Transfer ownership
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
