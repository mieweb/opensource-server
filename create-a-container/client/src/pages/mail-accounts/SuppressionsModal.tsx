import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, AlertDescription, Button, Modal, ModalBody, ModalHeader, ModalTitle, Spinner,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast,
} from '@mieweb/ui';
import { Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { keys, queries } from '@/lib/queries';
import type { MailAccount, MailSuppression } from '@/lib/types';

/** Recipients who one-click-unsubscribed from this account. Only admins can
 * remove entries — owners must not quietly re-subscribe people. */
export function SuppressionsModal({
  account,
  onClose,
}: {
  account: MailAccount;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const isAdmin = !!session?.isAdmin;
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({
    queryKey: keys.mailSuppressions(account.id),
    queryFn: () => queries.listMailSuppressions(account.id),
  });

  const remove = useMutation({
    mutationFn: (suppressionId: number) =>
      api.delete(`/api/v1/mail-accounts/${account.id}/suppressions/${suppressionId}`),
    onSuccess: () => {
      toast.success('Suppression removed');
      qc.invalidateQueries({ queryKey: keys.mailSuppressions(account.id) });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalHeader>
        <ModalTitle>Unsubscribed recipients — {account.address}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {error && (
          <Alert variant="danger">
            <AlertDescription>{(error as ApiError).message}</AlertDescription>
          </Alert>
        )}
        {isLoading && (
          <div className="flex justify-center p-6">
            <Spinner size="md" />
          </div>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-(--color-muted,#6b7280)">
            Nobody has unsubscribed from this account.
          </p>
        )}
        {data && data.length > 0 && (
          <Table responsive>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Since</TableHead>
                {isAdmin && (
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s: MailSuppression) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-sm">{s.recipient}</TableCell>
                  <TableCell>{s.source}</TableCell>
                  <TableCell>{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="cursor-pointer"
                        leftIcon={<Trash2 className="size-4" />}
                        onClick={() => {
                          if (confirm(`Allow mail to ${s.recipient} again?`)) remove.mutate(s.id);
                        }}
                        disabled={remove.isPending}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ModalBody>
    </Modal>
  );
}
