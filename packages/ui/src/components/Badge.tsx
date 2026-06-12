import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const badgeVariantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-hover text-text-muted',
  success: 'bg-success text-success-fg',
  warning: 'bg-warning text-warning-fg',
  danger: 'bg-danger text-danger-fg',
  accent: 'bg-accent-muted text-accent',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'neutral', className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={clsx(
        'inline-flex items-center gap-xs rounded-full px-sm py-[1px] text-xs font-medium',
        badgeVariantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});

export type StatusDotVariant = 'success' | 'warning' | 'danger' | 'neutral';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: StatusDotVariant;
}

const statusDotVariantClasses: Record<StatusDotVariant, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-text-faint',
};

export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(function StatusDot(
  { variant = 'neutral', className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={clsx('inline-block h-2 w-2 rounded-full', statusDotVariantClasses[variant], className)}
      {...props}
    />
  );
});
