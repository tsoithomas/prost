import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

export type SurfaceLevel = 'base' | 'sunken' | 'raised' | 'overlay';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  level?: SurfaceLevel;
  bordered?: boolean;
}

const levelClasses: Record<SurfaceLevel, string> = {
  base: 'bg-surface',
  sunken: 'bg-surface-sunken',
  raised: 'bg-surface-raised',
  overlay: 'bg-surface-overlay',
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { level = 'base', bordered = false, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={clsx(levelClasses[level], bordered && 'border border-border', className)}
      {...props}
    />
  );
});
