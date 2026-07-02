import { useEffect } from 'react';
import { Braces, Calendar, Check, RotateCcw, ToggleLeft } from 'lucide-react';
import type { ColumnRenderMode } from '@prost/shared-types';
import { availableRenderModes, type HeaderContextMenuArgs } from './columnDefs';

const MODE_LABEL: Record<ColumnRenderMode, string> = {
  date: 'Render as date',
  boolean: 'Render as boolean',
  json: 'Render as JSON',
};

const MODE_ICON: Record<ColumnRenderMode, typeof Calendar> = {
  date: Calendar,
  boolean: ToggleLeft,
  json: Braces,
};

interface Props {
  /** The right-clicked header (position + column), or null when the menu is closed. */
  state: HeaderContextMenuArgs | null;
  /** The column's current render override, if any. */
  currentMode?: ColumnRenderMode;
  /** Set the column's render mode, or `null` to clear it back to the raw value. */
  onSelect: (mode: ColumnRenderMode | null) => void;
  onClose: () => void;
}

/**
 * A custom right-click menu for choosing a column's "render as" display override. AG Grid Community
 * has no context-menu API, so this mirrors the custom-menu pattern in `SchemaTree` (fixed-positioned,
 * closes on any outside click / another context-menu / Escape).
 */
export function ColumnRenderMenu({ state, currentMode, onSelect, onClose }: Props) {
  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [state, onClose]);

  if (!state) return null;
  const modes = availableRenderModes(state.category);

  return (
    <div
      className="fixed z-50 min-w-[190px] overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {modes.length === 0 ? (
        <div className="px-3 py-1.5 text-xs text-text-faint">No display options for this column type</div>
      ) : (
        modes.map((mode) => {
          const Icon = MODE_ICON[mode];
          const active = currentMode === mode;
          return (
            <button
              key={mode}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface-hover"
              onClick={() => {
                onSelect(active ? null : mode);
                onClose();
              }}
            >
              <Icon size={13} className="shrink-0 text-text-faint" />
              <span className="flex-1 text-left">{MODE_LABEL[mode]}</span>
              {active ? <Check size={13} className="shrink-0 text-accent" /> : null}
            </button>
          );
        })
      )}
      {currentMode ? (
        <>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface-hover"
            onClick={() => {
              onSelect(null);
              onClose();
            }}
          >
            <RotateCcw size={13} className="shrink-0 text-text-faint" />
            <span className="flex-1 text-left">Show raw value</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
