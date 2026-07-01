import { useRef, useState } from 'react';
import { Button, Checkbox, Input, useClickOutside } from '@mieweb/ui';
import { ChevronDown, Filter, User as UserIcon, X } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A compact checkbox-popover multiselect. Selected values are controlled by the
 * parent so filter state stays in the URL. Closes on outside click.
 */
function MultiSelect({
  label,
  emptyLabel,
  icon,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string;
  /** Trigger summary shown when nothing is selected. */
  emptyLabel: string;
  icon?: React.ReactElement;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  const filtered =
    searchable && query
      ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
      : options;

  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        size="sm"
        leftIcon={icon}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-normal text-muted-foreground">{label}:</span>
        <span className="ml-1">{summary}</span>
        <ChevronDown className="ml-1 size-4" aria-hidden="true" />
      </Button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-border bg-white p-2 shadow-md dark:bg-neutral-900"
        >
          {searchable && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label={`Search ${label}`}
              className="mb-2 h-8"
            />
          )}
          <div className="flex max-h-60 flex-col gap-1 overflow-auto">
            {filtered.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground">No matches</p>
            )}
            {filtered.map((o) => (
              <div
                key={o.value}
                className="rounded px-1 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Checkbox
                  label={o.label}
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
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
          emptyLabel="Me"
          icon={<UserIcon className="size-4" />}
          options={userOptions}
          selected={selectedUsers}
          onChange={onUsersChange}
          searchable
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
