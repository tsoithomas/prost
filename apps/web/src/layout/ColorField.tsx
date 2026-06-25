import clsx from 'clsx';
import { Input } from '@prost/ui';

export interface ColorFieldProps {
  value: string;
  /** Fires on every keystroke / swatch change (live, may be a partial hex). */
  onChange: (value: string) => void;
  /** Fires when the value is "committed" — swatch pick (always valid) or text blur. */
  onCommit?: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}

/** Native color input requires a full `#rrggbb`; expand `#rgb` and fall back while typing. */
function toSwatchValue(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#000000';
}

/** A hex text field paired with a native color-picker swatch, two-way bound to one string value. */
export function ColorField({ value, onChange, onCommit, ariaLabel, placeholder, className }: ColorFieldProps) {
  // `className` sizes the whole field (e.g. `flex-1`/`w-40`); the swatch is fixed and the text
  // input fills the rest with `min-w-0` so it shrinks instead of overflowing the container.
  return (
    <div className={clsx('flex min-w-0 items-center gap-sm', className)}>
      <input
        type="color"
        aria-label={`${ariaLabel} picker`}
        value={toSwatchValue(value)}
        onChange={(e) => {
          onChange(e.target.value);
          onCommit?.(e.target.value);
        }}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-sm border border-border bg-surface p-[2px]"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="min-w-0 flex-1 font-mono text-xs"
      />
    </div>
  );
}
