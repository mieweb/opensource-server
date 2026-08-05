import { useContext, useEffect } from 'react';
import { DataVisNitroContext } from '@mieweb/ui/datavis';
import { useContainerViewDefault } from '@/lib/containerViewPreference';

/**
 * Applies the user's default container view each time the underlying DataVis
 * view is (re)created:
 *   - 'own'  (default): seed the owner filter to the current user, so the list
 *     opens showing only your own containers (preserving issue #413's default
 *     now that the separate filter bar is gone).
 *   - 'all': leave the view unfiltered so every container you may see (including
 *     shared) shows by default.
 * Either way the user can change/clear the filter from the "User" column; their
 * choice sticks until the data reloads. Preference lives in localStorage and is
 * editable from the Settings page. Renders nothing.
 */
export function DefaultOwnerFilter({ owner }: { owner?: string }) {
  const view = useContext(DataVisNitroContext);
  const mode = useContainerViewDefault();
  useEffect(() => {
    if (!view) return;
    try {
      if (mode === 'own' && owner) view.setFilter({ owner: { $eq: owner } });
      else view.clearFilter();
    } catch {
      /* best-effort: the grid still renders if the filter API shifts */
    }
  }, [view, owner, mode]);
  return null;
}
