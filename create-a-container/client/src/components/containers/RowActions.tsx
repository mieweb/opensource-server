import { Link } from 'react-router';
import { Button } from '@mieweb/ui';
import { Pencil, Share2, Trash2 } from 'lucide-react';
import { ButtonLink } from '@/components/ButtonLink';
import type { Container } from '@/lib/types';

/** Per-row actions for the containers list: logs, share, edit, delete. */
export function RowActions({
  c,
  siteId,
  onDelete,
  deleting,
  canShare,
  onShare,
}: {
  c: Container;
  siteId?: string;
  onDelete: (id: number) => void;
  deleting: boolean;
  canShare: boolean;
  onShare: (c: Container) => void;
}) {
  return (
    <>
      {c.creationJobId && (
        <ButtonLink as={Link} to={`/jobs/${c.creationJobId}`} variant="ghost" size="sm">
          Logs
        </ButtonLink>
      )}
      {canShare && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Share ${c.hostname}`}
          leftIcon={<Share2 className="size-4" />}
          onClick={() => onShare(c)}
        >
          <span className="hidden sm:inline">Share</span>
        </Button>
      )}
      <ButtonLink
        as={Link}
        to={`/sites/${siteId}/containers/${c.id}/edit`}
        variant="ghost"
        size="sm"
        aria-label="Edit"
        leftIcon={<Pencil className="size-4" />}
      >
        <span className="hidden sm:inline">Edit</span>
      </ButtonLink>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Delete"
        leftIcon={<Trash2 className="size-4" />}
        onClick={() => {
          if (confirm(`Delete container "${c.hostname}"?`)) onDelete(c.id);
        }}
        disabled={deleting}
        // Danger tint on hover only; the built-in ghost transition still applies.
        className="hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-200"
      >
        <span className="hidden sm:inline">Delete</span>
      </Button>
    </>
  );
}
