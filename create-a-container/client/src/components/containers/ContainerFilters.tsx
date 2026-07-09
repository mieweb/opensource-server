import { useState } from 'react';
import { Button, Input } from '@mieweb/ui';
import { Filter, User as UserIcon, X } from 'lucide-react';
import { MultiSelect, type FilterOption } from './MultiSelect';

// Re-exported for consumers that configure the filter bar (e.g. the list page).
export type { FilterOption };

export interface ContainerFiltersProps {
  userOptions: FilterOption[];
  selectedUsers: string[];
  onUsersChange: (next: string[]) => void;
  statusOptions: FilterOption[];
  selectedStatuses: string[];
  onStatusesChange: (next: string[]) => void;
  templateOptions: FilterOption[];
  selectedTemplates: string[];
  onTemplatesChange: (next: string[]) => void;
  hostname: string;
  onHostnameChange: (next: string) => void;
  onClearAll: () => void;
}

/**
 * Filter bar for the containers list. "User" is always visible and drives the
 * server query; the remaining filters (status, template, hostname) live behind
 * a "More filters" disclosure and filter the loaded rows client-side.
 */
export function ContainerFilters({
  userOptions,
  selectedUsers,
  onUsersChange,
  statusOptions,
  selectedStatuses,
  onStatusesChange,
  templateOptions,
  selectedTemplates,
  onTemplatesChange,
  hostname,
  onHostnameChange,
  onClearAll,
}: ContainerFiltersProps) {
  const [showMore, setShowMore] = useState(false);
  const extraCount =
    selectedStatuses.length + selectedTemplates.length + (hostname ? 1 : 0);
  const activeCount = selectedUsers.length + extraCount;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          label="User"
          emptyLabel="All"
          icon={<UserIcon className="size-4" />}
          options={userOptions}
          selected={selectedUsers}
          onChange={onUsersChange}
          searchable
          showSelectAll
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Filter className="size-4" />}
          aria-expanded={showMore}
          onClick={() => setShowMore((s) => !s)}
        >
          More filters{extraCount > 0 ? ` (${extraCount})` : ''}
        </Button>
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<X className="size-4" />}
            onClick={onClearAll}
            className="ml-auto text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>
      {showMore && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <MultiSelect
            label="Status"
            emptyLabel="Any"
            options={statusOptions}
            selected={selectedStatuses}
            onChange={onStatusesChange}
          />
          <MultiSelect
            label="Template"
            emptyLabel="Any"
            options={templateOptions}
            selected={selectedTemplates}
            onChange={onTemplatesChange}
            searchable
          />
          <Input
            value={hostname}
            onChange={(e) => onHostnameChange(e.target.value)}
            placeholder="Search hostname…"
            aria-label="Search by hostname"
            className="h-8 w-48"
          />
        </div>
      )}
    </div>
  );
}
