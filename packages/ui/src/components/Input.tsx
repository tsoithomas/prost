import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import clsx from 'clsx';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        'h-7 rounded-sm border border-border bg-surface px-sm text-sm text-text',
        'placeholder:text-text-faint',
        'focus:outline-none focus:border-accent',
        'transition-colors',
        className,
      )}
      {...props}
    />
  );
});
