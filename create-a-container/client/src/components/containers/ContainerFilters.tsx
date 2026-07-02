import { useState } from 'react';
import { Button, Dropdown, DropdownItem, Input } from '@mieweb/ui';
import { ChevronDown, Filter, User as UserIcon, X } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A compact multiselect built on @mieweb/ui's Dropdown (multiSelect mode).
 * Selected values are controlled by the parent so filter state stays in the URL.
 */
function MultiSelect({
  label,
  emptyLabel,
  icon,
  options,
  selected,
  onChange,
  searchable = false,
  showSelectAll = false,
}: {
  label: string;
  /** Trigger summary shown when nothing is selected. */
  emptyLabel: string;
  icon?: React.ReactElement;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  showSelectAll?: boolean;
}) {
  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  return (
    <Dropdown
      multiSelect
      selectedValues={selected}
      onSelectedValuesChange={onChange}
      searchable={searchable}
      searchPlaceholder="Search…"
      searchAriaLabel={`Search ${label}`}
      showSelectAll={showSelectAll}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={icon}
          aria-label={`${label}: ${summary}`}
        >
          <span className="font-normal text-muted-foreground">{label}:</span>
          <span className="ml-1">{summary}</span>
          <ChevronDown className="ml-1 size-4" aria-hidden="true" />
        </Button>
      }
    >
      {options.map((o) => (
        <DropdownItem key={o.value} value={o.value}>
          {o.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

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
