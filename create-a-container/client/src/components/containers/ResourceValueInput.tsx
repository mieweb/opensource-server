import { useState } from 'react';
import { Input, Select } from '@mieweb/ui';

const CUSTOM_OPTION = '__custom__';

/**
 * Format a resource value for display in the preset dropdown. Memory-style
 * units (MB) are shown as whole GB when they divide evenly, so users pick
 * familiar sizes (e.g. "4 GB") instead of raw megabyte counts.
 */
function formatPreset(value: number, unit: string): string {
  if (unit === 'MB' && value >= 1024 && value % 1024 === 0) {
    return `${value / 1024} GB`;
  }
  if (unit) return `${value} ${unit}`;
  return `${value}`;
}

interface ResourceValueInputProps {
  label: string;
  unit: string;
  min: number;
  step: number;
  presets: readonly number[];
  value: number;
  onChange: (value: number) => void;
}

/**
 * Resource size selector combining a dropdown of common presets with a
 * "Custom…" option that reveals a number input. This avoids per-unit up/down
 * arrow nudging on large megabyte values while still allowing precise editing.
 */
export function ResourceValueInput({
  label,
  unit,
  min,
  step,
  presets,
  value,
  onChange,
}: ResourceValueInputProps) {
  const [isCustom, setIsCustom] = useState(() => !presets.includes(value));

  // Show the editable number input when the user explicitly chose "Custom…" or
  // when the current value doesn't match any preset (e.g. an existing custom
  // allocation being edited).
  const showCustom = isCustom || !presets.includes(value);

  const options = [
    ...presets.map((preset) => ({
      value: String(preset),
      label: formatPreset(preset, unit),
    })),
    { value: CUSTOM_OPTION, label: 'Custom…' },
  ];

  const selectValue = showCustom ? CUSTOM_OPTION : String(value);

  return (
    <div className="flex items-center gap-2">
      <Select
        size="sm"
        value={selectValue}
        options={options}
        aria-label={`${label} preset`}
        onValueChange={(v) => {
          if (v === CUSTOM_OPTION) {
            setIsCustom(true);
            return;
          }
          setIsCustom(false);
          onChange(parseInt(v, 10) || 0);
        }}
        className="w-32"
      />
      {showCustom && (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            size="sm"
            min={min}
            step={step}
            value={value}
            onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
            className="w-24"
            aria-label={`New ${label} value`}
          />
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
      )}
    </div>
  );
}
