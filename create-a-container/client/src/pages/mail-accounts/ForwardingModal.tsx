import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert, AlertDescription, Button, Input, Modal, ModalBody, ModalClose, ModalFooter,
  ModalHeader, ModalTitle, Switch, useToast,
} from '@mieweb/ui';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { MailAccount } from '@/lib/types';

/** Mirrors MAX_MAIL_FORWARDS on the server (utils/mail-account.js). */
const MAX_FORWARDS = 5;

/** Edit the addresses that receive a copy of this account's inbound mail. */
export function ForwardingModal({
  account,
  onClose,
}: {
  account: MailAccount;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [forwards, setForwards] = useState<string[]>(
    account.forwards.length > 0 ? account.forwards : [''],
  );
  const [keepCopy, setKeepCopy] = useState(account.forwardKeepCopy);

  const save = useMutation({
    mutationFn: () =>
      api.patch<MailAccount>(`/api/v1/mail-accounts/${account.id}`, {
        forwards: forwards.map((f) => f.trim()).filter(Boolean),
        forwardKeepCopy: keepCopy,
      }),
    onSuccess: () => {
      toast.success('Forwarding saved');
      qc.invalidateQueries({ queryKey: keys.mailAccounts() });
      onClose();
    },
  });

  const setAt = (index: number, value: string) =>
    setForwards((list) => list.map((f, i) => (i === index ? value : f)));
  const removeAt = (index: number) =>
    setForwards((list) => (list.length === 1 ? [''] : list.filter((_, i) => i !== index)));

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} size="lg">
      <ModalHeader>
        <ModalTitle>Forwarding — {account.address}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <ModalBody className="flex flex-col gap-4">
          <p className="text-sm text-(--color-muted,#6b7280)">
            Inbound mail to this address is also sent to up to {MAX_FORWARDS} other addresses.
            Leave every field empty to turn forwarding off.
          </p>
          {account.domain && !account.domain.canReceive && (
            <Alert variant="warning">
              <AlertDescription>
                This domain cannot receive mail yet (MX not verified), so nothing is forwarded
                until it can.
              </AlertDescription>
            </Alert>
          )}
          <ul className="flex flex-col gap-2" aria-label="Forwarding addresses">
            {forwards.map((value, index) => (
              <li key={index} className="flex items-end gap-2">
                <Input
                  className="flex-1"
                  type="email"
                  label={index === 0 ? 'Forward to' : undefined}
                  aria-label={`Forwarding address ${index + 1}`}
                  placeholder="someone@example.org"
                  value={value}
                  onChange={(e) => setAt(index, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer"
                  aria-label={`Remove forwarding address ${index + 1}`}
                  leftIcon={<Trash2 className="size-4" />}
                  onClick={() => removeAt(index)}
                />
              </li>
            ))}
          </ul>
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              leftIcon={<Plus className="size-4" />}
              onClick={() => setForwards((list) => [...list, ''])}
              disabled={forwards.length >= MAX_FORWARDS}
            >
              Add address
            </Button>
          </div>
          <Switch
            label="Keep a copy in this mailbox"
            description="Turn off to forward only — nothing is stored here."
            checked={keepCopy}
            onCheckedChange={setKeepCopy}
          />
          {save.error && (
            <Alert variant="danger" role="alert">
              <AlertDescription>{(save.error as ApiError).message}</AlertDescription>
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" className="cursor-pointer" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="cursor-pointer" isLoading={save.isPending}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
