import { useContext, useEffect } from 'react';
import { DataVisNitroContext } from '@mieweb/ui/datavis';

/**
 * Seeds the grid's owner filter to the current user each time the underlying
 * DataVis view is (re)created, so the Containers list opens showing only your
 * own containers (preserving the default from issue #413 now that the separate
 * filter bar is gone). Users can change or clear the filter from the "User"
 * column; their choice sticks until the data reloads. Renders nothing.
 */
export function DefaultOwnerFilter({ owner }: { owner?: string }) {
  const view = useContext(DataVisNitroContext);
  useEffect(() => {
    if (!view || !owner) return;
    try {
      view.setFilter({ owner: { $eq: owner } });
    } catch {
      /* best-effort: the grid still renders unfiltered if the API shifts */
    }
  }, [view, owner]);
  return null;
}
