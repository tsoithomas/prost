import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /**
   * `vertical` renders a left rail (desktop settings nav); `horizontal` a scrollable strip.
   * Defaults to a rail on desktop that collapses to a horizontal strip on mobile.
   */
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  'aria-label'?: string;
}

/**
 * A minimal, token-themed section nav (`role="tablist"`). Panels are rendered by the caller keyed on
 * `value`; this only owns selection + roving `aria-selected`. Vertical rail on desktop, horizontal
 * strip on mobile.
 */
export function Tabs({ items, value, onChange, orientation, className, 'aria-label': ariaLabel }: TabsProps) {
  const vertical = orientation === 'vertical';
  const horizontal = orientation === 'horizontal';
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={clsx(
        'flex gap-1',
        vertical && 'flex-col',
        horizontal && 'flex-row overflow-x-auto',
        !vertical && !horizontal && 'flex-col max-md:flex-row max-md:overflow-x-auto',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={clsx(
              'flex items-center gap-sm whitespace-nowrap rounded-md px-sm py-1.5 text-left text-sm transition-colors max-md:shrink-0',
              selected
                ? 'bg-accent-muted font-medium text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
