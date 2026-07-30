import { X } from 'lucide-react';
import { IconButton, Modal } from '@prost/ui';

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
  return (
    <Modal
      open={!!cell}
      onClose={onClose}
      title={cell ? `JSON value of ${cell.column}` : ''}
      hideTitle
      className="max-h-[80vh] w-full max-w-[42rem] gap-sm p-lg max-md:max-h-[70vh] max-md:max-w-none"
    >
      <div className="flex items-center justify-between gap-sm">
        <h2 className="truncate font-mono text-sm font-semibold text-text">{cell?.column}</h2>
        <IconButton aria-label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded-sm bg-surface-sunken p-sm font-mono text-xs text-text">
        {cell ? prettify(cell.value) : ''}
      </pre>
    </Modal>
  );
}
