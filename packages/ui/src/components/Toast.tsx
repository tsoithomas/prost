import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import clsx from 'clsx';
import { StatusDot, type StatusDotVariant } from './Badge';
import { Surface } from './Surface';

export type ToastVariant = 'success' | 'danger';

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  variant?: ToastVariant;
  message: string;
  onDismiss?: () => void;
}

const dotVariant: Record<ToastVariant, StatusDotVariant> = {
  success: 'success',
  danger: 'danger',
};

export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  { variant = 'danger', message, onDismiss, className, ...props },
  ref,
) {
  return (
    <Surface
      ref={ref}
      level="overlay"
      bordered
      role="alert"
      className={clsx('flex items-start gap-sm rounded-md px-md py-sm text-sm shadow-lg', className)}
      {...props}
    >
      <StatusDot variant={dotVariant[variant]} className="mt-[5px] shrink-0" />
      <span className="flex-1 text-text">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="shrink-0 leading-none text-text-faint hover:text-text"
        >
          ×
        </button>
      ) : null}
    </Surface>
  );
});
