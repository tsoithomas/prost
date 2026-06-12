import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface FormFieldProps {
  label: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, className, children }: FormFieldProps) {
  return (
    <label className={clsx('flex flex-col gap-xs', className)}>
      <span className="text-xs font-medium text-text-faint">{label}</span>
      {children}
    </label>
  );
}
