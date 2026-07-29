import clsx from 'clsx';

export interface SegmentedGroupProps<T extends string | number> {
  label: string;
  options: readonly T[];
  value: T;
  render: (option: T) => string;
  onSelect: (option: T) => void;
}

/** A labeled row of mutually-exclusive segmented buttons (color mode, font size, density, …). */
export function SegmentedGroup<T extends string | number>({ label, options, value, render, onSelect }: SegmentedGroupProps<T>) {
  return (
    <div>
      <p className="mb-xs text-xs font-medium text-text-muted">{label}</p>
      <div className="flex gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={clsx(
              'flex-1 rounded-sm px-sm py-1 text-xs transition-colors',
              value === option
                ? 'bg-accent-muted text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
