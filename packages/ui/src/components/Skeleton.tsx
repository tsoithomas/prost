import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** A shimmering placeholder block (Phase 40) — the `prost-skeleton` keyframe lives in `tokens.css`. */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={clsx('prost-skeleton rounded-sm', className)} {...props} />;
}

export interface SkeletonRowsProps {
  /** Number of shimmer rows to render. */
  rows?: number;
  /** Number of column blocks per row. */
  columns?: number;
  className?: string;
}

/** A grid-shaped loading placeholder (Phase 40) — used while table rows/columns are still loading. */
export function SkeletonRows({ rows = 8, columns = 5, className }: SkeletonRowsProps) {
  return (
    <div className={clsx('flex h-full flex-col gap-2 p-md', className)} aria-hidden>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
