import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import clsx from 'clsx';

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * An iOS-style pill toggle for on/off settings. It's a real `<input type="checkbox">` (kept
 * transparent and overlaid on the pill) so the `checked` / `onChange(e)` API and accessibility match
 * `Checkbox` exactly — a drop-in for setting toggles. The pill track + knob are token-styled and
 * animate on `peer-checked`. Use `Checkbox` (not this) for list selection or structural form flags.
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({ className, ...props }, ref) {
  return (
    <span className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span className="h-5 w-9 rounded-full bg-border transition-colors peer-checked:bg-accent peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-surface" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </span>
  );
});
