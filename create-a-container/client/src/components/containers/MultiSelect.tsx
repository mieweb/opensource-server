import { Button, Dropdown, DropdownItem } from '@mieweb/ui';
import { ChevronDown } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A compact multiselect built on @mieweb/ui's Dropdown (multiSelect mode).
 * Selected values are controlled by the parent so filter state stays in the URL.
 */
export function MultiSelect({
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
