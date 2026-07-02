import { Link } from 'react-router';
import { Button } from '@mieweb/ui';
import { Pencil, Share2, Trash2 } from 'lucide-react';
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
        <Link to={`/jobs/${c.creationJobId}`}>
          <Button
            variant="ghost"
            size="sm"
            className="transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Logs
          </Button>
        </Link>
      )}
      {canShare && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Share ${c.hostname}`}
          leftIcon={<Share2 className="size-4" />}
          onClick={() => onShare(c)}
          className="transition-colors hover:bg-violet-100 hover:text-violet-700 dark:hover:bg-violet-900/40 dark:hover:text-violet-200"
        >
          <span className="hidden sm:inline">Share</span>
        </Button>
      )}
      <Link to={`/sites/${siteId}/containers/${c.id}/edit`}>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Edit"
          leftIcon={<Pencil className="size-4" />}
          className="transition-colors hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/40 dark:hover:text-sky-200"
        >
          <span className="hidden sm:inline">Edit</span>
        </Button>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Delete"
        leftIcon={<Trash2 className="size-4" />}
        onClick={() => {
          if (confirm(`Delete container "${c.hostname}"?`)) onDelete(c.id);
        }}
        disabled={deleting}
        className="transition-colors hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-200"
      >
        <span className="hidden sm:inline">Delete</span>
      </Button>
    </>
  );
}
