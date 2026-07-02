import { X } from 'lucide-react';
import { IconButton, Surface } from '@prost/ui';

interface Props {
  /** The cell's column name (header) and raw value, or null when closed. */
  cell: { column: string; value: unknown } | null;
  onClose: () => void;
}

/** Prettifies a value as JSON, falling back to the raw string when it isn't valid JSON. */
function prettify(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * A read-only overlay showing a cell's value as prettified JSON, opened when a `json`-rendered cell is
 * clicked. Centered card on desktop; full-width bottom sheet on mobile (matching `ConfirmDialog`).
 */
export function JsonCellPopup({ cell, onClose }: Props) {
  if (!cell) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md max-md:items-end max-md:justify-stretch max-md:p-0"
      onClick={onClose}
    >
      <Surface
        level="overlay"
        bordered
        role="dialog"
        aria-modal="true"
        aria-label={`JSON value of ${cell.column}`}
        className="flex max-h-[80vh] w-full max-w-[42rem] flex-col gap-sm rounded-lg p-lg shadow-2xl max-md:max-h-[70vh] max-md:max-w-none max-md:rounded-b-none max-md:rounded-t-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-sm">
          <h2 className="truncate font-mono text-sm font-semibold text-text">{cell.column}</h2>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto rounded-sm bg-surface-sunken p-sm font-mono text-xs text-text">
          {prettify(cell.value)}
        </pre>
      </Surface>
    </div>
  );
}
