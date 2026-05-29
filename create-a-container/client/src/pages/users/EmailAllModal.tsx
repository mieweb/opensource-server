import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Textarea,
  useToast,
} from '@mieweb/ui';
import { Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

interface EmailAllModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientCount: number;
}

interface EmailAllResponse {
  sent: number;
  failed: number;
  recipients: number;
}

export function EmailAllModal({ open, onOpenChange, recipientCount }: EmailAllModalProps) {
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const mutation = useMutation<EmailAllResponse, ApiError, { subject: string; message: string }>({
    mutationFn: (body) => api.post<EmailAllResponse>('/api/v1/users/email-all', body),
    onSuccess: (res) => {
      toast.success(
        res.failed > 0
          ? `Sent ${res.sent} of ${res.recipients} (${res.failed} failed)`
          : `Email sent to ${res.sent} user${res.sent === 1 ? '' : 's'}`,
      );
      setSubject('');
      setMessage('');
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    mutation.mutate({ subject: subject.trim(), message });
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg">
      <ModalHeader>
        <ModalTitle>Email all users</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <form onSubmit={onSubmit}>
        <ModalBody className="flex flex-col gap-4">
          <p className="text-sm text-[var(--mieweb-muted-foreground,#737373)]">
            This message will be sent to{' '}
            <strong>{recipientCount}</strong> user{recipientCount === 1 ? '' : 's'} with an email
            address on file.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email-all-subject" className="text-sm font-medium">
              Subject
            </label>
            <Input
              id="email-all-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Announcement subject"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email-all-message" className="text-sm font-medium">
              Message
            </label>
            <Textarea
              id="email-all-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your message…"
              rows={8}
              required
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            leftIcon={<Send className="size-4" />}
            isLoading={mutation.isPending}
            disabled={!subject.trim() || !message.trim() || recipientCount === 0}
          >
            Send
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
