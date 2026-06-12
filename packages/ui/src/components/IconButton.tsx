import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

export type IconButtonVariant = 'ghost' | 'solid' | 'active';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  variant?: IconButtonVariant;
  /** Required since the button has no visible text label. */
  'aria-label': string;
}

const variantClasses: Record<IconButtonVariant, string> = {
  ghost: 'text-text-muted hover:bg-surface-hover hover:text-text',
  solid: 'bg-surface-raised text-text hover:bg-surface-hover',
  active: 'bg-surface-hover text-accent',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});
