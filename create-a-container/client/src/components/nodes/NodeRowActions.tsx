import { Link } from 'react-router';
import { Button } from '@mieweb/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { ButtonLink } from '@/components/ButtonLink';
import type { Node } from '@/lib/types';

/** Per-row actions for the nodes list: edit, delete. */
export function NodeRowActions({
  n,
  siteId,
  onDelete,
  deleting,
}: {
  n: Node;
  siteId?: string;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  return (
    <>
      <ButtonLink
        as={Link}
        to={`/sites/${siteId}/nodes/${n.id}/edit`}
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
          if (confirm(`Delete node "${n.name}"?`)) onDelete(n.id);
        }}
        disabled={deleting}
        className="cursor-pointer"
      >
        <span className="hidden sm:inline">Delete</span>
      </Button>
    </>
  );
}
