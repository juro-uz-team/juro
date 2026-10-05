"use client";

import { Select } from "../_components/Select";

export type AiSelectOption<T extends string> = { value: T; label: string };

type AiSelectProps<T extends string> = {
  id?: string;
  value: T;
  options: readonly AiSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

export function AiSelect<T extends string>({ id, value, options, onChange, disabled, ariaLabel, ariaLabelledBy }: AiSelectProps<T>) {
  return <div className="ai-select">
    <Select id={id} value={value} disabled={disabled} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}
      onChange={event => {
        const option = options.find(item => item.value === event.target.value);
        if (option) onChange(option.value);
      }}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  </div>;
}
