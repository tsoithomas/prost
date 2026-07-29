import type { UserPreferenceDto } from '@prost/shared-types';
import { Switch } from '@prost/ui';

/** Shared props for every settings-modal section. */
export interface SectionProps {
  save: (dto: Partial<UserPreferenceDto>) => void;
  /** Lowercased free-text filter applied to control labels; empty = show all. */
  query?: string;
}

/** True when `label` matches the active search filter (lowercased), or there is no filter. */
export function match(label: string, query?: string): boolean {
  return !query || label.toLowerCase().includes(query);
}

export interface SettingSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** A labeled on/off row: text on the left, a `Switch` on the right. */
export function SettingSwitch({ label, description, checked, onChange }: SettingSwitchProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-md">
      <span className="flex flex-col">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {description ? <span className="text-xs text-text-faint">{description}</span> : null}
      </span>
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
